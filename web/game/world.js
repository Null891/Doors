// world.js — the room sequence: generation, weighted templates with
// overlap-safe rerolling, the three special rooms (library/shop/elevator),
// and culling the oldest room once too many are loaded (the "Void" straggler
// check is a callback so World never needs to know about Player directly).

import { CFG } from './config.js';
import { rand, randInt, chance, aabbOverlap2D, pointInAabb, frameAt, subFrame } from './utils.js';
import { buildRoom, footprintAabb, stepRoomAnimations, GAP } from './rooms.js';

const TEMPLATES = [
  { name: 'Hallway', weight: 6, length: [40, 60], exit: 'end' },
  { name: 'GrandHall', weight: 2, length: [64, 88], exit: 'end' },
  { name: 'TurnLeft', weight: 2, length: [36, 48], exit: 'left' },
  { name: 'TurnRight', weight: 2, length: [36, 48], exit: 'right' },
];

function pickTemplate() {
  let total = 0;
  for (const t of TEMPLATES) total += t.weight;
  let roll = rand(0, total);
  for (const t of TEMPLATES) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return TEMPLATES[0];
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rooms = [];
  }

  reset() {
    for (const r of this.rooms) r.dispose();
    this.rooms = [];
    const frame = frameAt(0, 0, 0);
    const room = buildRoom(frame, { number: 0, length: 44, exit: 'end', exitOffset: 0, isLobby: true });
    this.scene.add(room.group);
    this.rooms.push(room);
    return room;
  }

  getActiveRooms() { return this.rooms; }
  getCurrentRoom() { return this.rooms[this.rooms.length - 1]; }

  getRoomAt(x, y, z) {
    for (const r of this.rooms) {
      if (pointInAabb(x, y, z, r.bounds)) return r;
    }
    return null;
  }

  getColliders() {
    const out = [];
    for (const r of this.rooms) {
      for (const c of r.colliders) out.push(c);
      if (r.exitDoor && !r.exitDoor.opened) out.push(r.exitDoor.collider);
    }
    return out;
  }

  forceUnlock(room) {
    if (!room.exitDoor) return;
    room.exitDoor.locked = false;
    if (room.exitDoor.padlockMesh) room.exitDoor.padlockMesh.visible = false;
  }

  update(dt) {
    for (const r of this.rooms) stepRoomAnimations(r, dt);
  }

  // Removes the oldest room(s) once more than CFG.room.maxLoaded are active.
  // onStraggler(room) is called BEFORE disposal if playerPos was still inside
  // the room being culled — the caller (main.js) does the Void damage/teleport.
  cullIfNeeded(playerPos, onStraggler) {
    while (this.rooms.length > CFG.room.maxLoaded) {
      const old = this.rooms.shift();
      if (playerPos && pointInAabb(playerPos.x, playerPos.y, playerPos.z, old.bounds)) {
        onStraggler(old);
      }
      old.dispose();
    }
  }

  generateNext() {
    const current = this.getCurrentRoom();
    const number = current.number + 1;
    const entryFrame = subFrame(current.exitFrame, 0, GAP);

    let opts;
    if (number === CFG.room.finalRoom) {
      opts = { number, length: 30, exit: 'none', isElevator: true };
    } else if (CFG.room.shopRooms.includes(number)) {
      opts = { number, length: 44, exit: 'end', exitOffset: 0, isShop: true };
    } else if (number === CFG.room.libraryRoom) {
      opts = { number, length: 80, exit: 'end', exitOffset: 0, isLibrary: true };
    } else {
      opts = this._rollTemplate(number, entryFrame);
    }

    const room = buildRoom(entryFrame, opts);
    this.scene.add(room.group);
    this.rooms.push(room);
    return room;
  }

  _rollTemplate(number, entryFrame) {
    const current = this.getCurrentRoom();
    let chosen = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const template = attempt < 5 ? pickTemplate() : TEMPLATES[0];
      const length = randInt(template.length[0], template.length[1]);
      const offsets = [-CFG.room.W / 4, 0, CFG.room.W / 4];
      const exitOffset = template.exit === 'end' ? offsets[randInt(0, 2)] : 0;

      const footprint = footprintAabb(
        entryFrame, -(CFG.room.W / 2 + 2), CFG.room.W / 2 + 2, -3, length + 3, 0, 1,
      );
      let overlap = false;
      for (const r of this.rooms) {
        if (r === current) continue;
        if (aabbOverlap2D(footprint, r.bounds, 1.5)) { overlap = true; break; }
      }
      if (!overlap || attempt === 7) {
        chosen = { length, exit: template.exit, exitOffset };
        break;
      }
    }

    const lockable = number >= CFG.room.lockedMinRoom
      && !CFG.room.shopRooms.includes(number + 1)
      && number + 1 !== CFG.room.libraryRoom
      && number + 1 !== CFG.room.finalRoom;
    const locked = lockable && chance(CFG.room.lockedChance);

    const dark = (number >= CFG.room.greenhouseStart && number < CFG.room.finalRoom)
      || (number >= CFG.room.darkMinRoom && chance(CFG.room.darkChance));

    return { number, length: chosen.length, exit: chosen.exit, exitOffset: chosen.exitOffset, locked, dark };
  }
}
