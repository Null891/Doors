// director.js — the spawn director. Every opened door rolls the hazard
// table; every frame it ticks whichever entities are currently live. This
// is the only module main.js needs to talk to for monster/hazard behavior.

import { CFG } from '../config.js';
import { chance, randInt } from '../utils.js';
import { Sweeper } from './sweeper.js';
import { Screech } from './screech.js';
import { EyesEntity } from './eyes.js';
import { Halt } from './halt.js';
import { Figure } from './figure.js';
import { Seek } from './seek.js';
import { AmbientScares } from './ambient.js';
import { maybeAddDupeDoor } from './dupe.js';
import { updateJack, resetJack } from './jack.js';
import { updateTimothy, resetTimothy } from './timothy.js';
import { initLibrary } from './library.js';
import { initElectrical } from './electrical.js';

// Real DOORS stages its two Seek chases at a door in the ~30s and again in
// the ~60s-70s stretch; the exact door is re-rolled each run.
const seekDoorRolls = () => [randInt(30, 40), randInt(62, 72)];

export class Director {
  constructor() {
    this.sweeper = new Sweeper();
    this.screech = new Screech();
    this.eyes = new EyesEntity();
    this.halt = new Halt();
    this.figure = new Figure();
    this.seek = new Seek();
    this.ambient = new AmbientScares();
    this._seekDoors = seekDoorRolls();
    this._lastSweepRoom = -100;
  }

  // Called once, right after world.generateNext()/world.reset() produces a
  // new room and the player has stepped into it.
  onDoorOpened(room, ctx) {
    // Eyes always scatter the instant the player moves on to the next
    // door, in any room type — so this runs before the special-case
    // branches below, not just the normal-room path.
    this.eyes.despawnExcept(room);

    if (room.isLibrary) {
      initLibrary(room, ctx, this.figure);
      return;
    }
    if (room.isElevator) {
      initElectrical(room, ctx);
      return;
    }
    if (room.isShop || room.isLobby || room.number < 1) return;

    // Seek chase: fires at its rolled door (twice per run), owning the door
    // outright — no other hazard stacks on top of the chase's opening beat,
    // and nothing else rolls while the chase is live.
    if (this._seekDoors.length && room.number >= this._seekDoors[0]
        && !this.sweeper.active && !this.halt.active && !this.seek.active) {
      this._seekDoors.shift();
      this.seek.trigger();
      return;
    }
    if (this.seek.active) return;

    maybeAddDupeDoor(room);

    if (!this.sweeper.active) {
      const recentRooms = ctx.world.getActiveRooms().slice(-2);
      const closetsNearby = recentRooms.some((r) => r.closets.length > 0);
      if (room.number - this._lastSweepRoom >= CFG.rush.minRoomsBetween && closetsNearby) {
        const rushChance = Math.min(CFG.rush.baseChance + room.number * CFG.rush.perRoom, CFG.rush.maxChance);
        if (chance(rushChance)) {
          this._lastSweepRoom = room.number;
          this.sweeper.trigger('Rush');
        } else if (room.number >= CFG.ambush.minRoom && chance(CFG.ambush.chance)) {
          this._lastSweepRoom = room.number;
          this.sweeper.trigger('Ambush');
        }
      }
    }

    if (room.number >= CFG.eyes.minRoom && chance(CFG.eyes.chance)) {
      this.eyes.spawn(room);
    }

    if (room.number >= CFG.halt.minRoom && !this.halt.active && chance(CFG.halt.chance)) {
      this.halt.trigger();
    }
  }

  update(dt, ctx) {
    this.sweeper.update(dt, ctx);
    this.screech.update(dt, ctx);
    this.eyes.update(dt, ctx);
    this.halt.update(dt, ctx);
    this.figure.update(dt, ctx);
    this.seek.update(dt, ctx);
    this.ambient.update(dt, ctx);
    updateJack(dt, ctx);
    updateTimothy(dt, ctx);
  }

  onInteractionNoise(pos) {
    if (this.figure.active) this.figure.onInteractionNoise(pos);
  }

  onBookRead() {
    if (this.figure.active) this.figure.onBookRead();
  }

  reset() {
    this.sweeper.reset();
    this.screech.reset();
    this.eyes.despawnAll();
    this.halt.reset();
    this.figure.reset();
    this.seek.reset();
    this.ambient.reset();
    this._seekDoors = seekDoorRolls();
    this._lastSweepRoom = -100;
    resetJack();
    resetTimothy();
  }
}
