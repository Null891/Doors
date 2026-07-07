// dupe.js — a fake exit door with a wrong number, mounted on a room's free
// side wall. Applied at generation time (not a per-frame entity). Interacting
// with it deals damage and scrambles the plate permanently.

import * as THREE from '../../vendor/three.module.min.js';
import { CFG } from '../config.js';
import { chance, choice, toWorld, fwdOf, rightOf } from '../utils.js';
import { Mats } from '../textures.js';
import { Sfx } from '../audio.js';

export function maybeAddDupeDoor(room) {
  if (room.number < CFG.dupe.minRoom) return;
  if (!chance(CFG.dupe.chance)) return;
  // Only mount a decoy on a free side wall — rooms whose real exit is
  // already on a side wall don't have one to spare.
  if (!room.exitDoor || room.exitDoor.isSideExit) return;

  const side = choice([-1, 1]);
  const W = CFG.room.W;
  const z = Math.min(room.length - 6, Math.max(10, room.length - CFG.room.sideInset));
  const frame = room.frame;
  const gw = CFG.room.doorW, gh = CFG.room.doorH;
  const localX = side * (W / 2);
  const yaw = Math.atan2(fwdOf(frame)[0], fwdOf(frame)[1]);
  const p = toWorld(frame, localX, z);

  const frameGeo = new THREE.BoxGeometry(0.6, gh, gw - 0.6);
  const frameMesh = new THREE.Mesh(frameGeo, Mats.frame);
  frameMesh.position.set(p.x, gh / 2, p.z);
  frameMesh.rotation.y = yaw;
  room.group.add(frameMesh);

  const doorGeo = new THREE.BoxGeometry(0.4, gh - 0.8, gw - 1.2);
  const doorMesh = new THREE.Mesh(doorGeo, Mats.door());
  doorMesh.position.set(p.x + side * 0.2, gh / 2, p.z);
  doorMesh.rotation.y = yaw;
  room.group.add(doorMesh);

  // Side-wall mounted, so the plate needs to face INWARD (toward the room
  // center) not "forward" — a flat plane only reads correctly from the
  // side its front normal points to (see rooms.js's exit-door plate fix).
  let fakeNumber = room.number + 1 + choice([-8, -7, -6, -5, 5, 6, 7, 8]);
  fakeNumber = Math.max(1, fakeNumber);
  const right = rightOf(frame);
  const plateYaw = Math.atan2(-side * right[0], -side * right[1]);
  const plateGeo = new THREE.PlaneGeometry(1.6, 0.8);
  const plateMat = Mats.numberPlate(fakeNumber);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.set(p.x - side * 0.42, gh * 0.62, p.z);
  plate.rotation.y = plateYaw;
  room.group.add(plate);

  let used = false;
  room.interactables.push({
    pos: { x: p.x, y: gh / 2, z: p.z }, range: 4,
    getLabel: () => used ? null : `Door ${fakeNumber}`,
    interact: (ctx) => {
      if (used) return;
      used = true;
      Sfx.growl(0.6);
      ctx.game.shake(1);
      ctx.game.notify('Not the real door...', '#c33');
      ctx.player.damage(CFG.dupe.damage);
      if (ctx.player.health <= 0) ctx.game.killPlayer('Dupe');
    },
  });
}
