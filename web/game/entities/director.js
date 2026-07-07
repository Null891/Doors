// director.js — the spawn director. Every opened door rolls the hazard
// table; every frame it ticks whichever entities are currently live. This
// is the only module main.js needs to talk to for monster/hazard behavior.

import { CFG } from '../config.js';
import { chance } from '../utils.js';
import { Sweeper } from './sweeper.js';
import { Screech } from './screech.js';
import { EyesEntity } from './eyes.js';
import { Halt } from './halt.js';
import { Figure } from './figure.js';
import { maybeAddDupeDoor } from './dupe.js';
import { updateJack, resetJack } from './jack.js';
import { initLibrary } from './library.js';

export class Director {
  constructor() {
    this.sweeper = new Sweeper();
    this.screech = new Screech();
    this.eyes = new EyesEntity();
    this.halt = new Halt();
    this.figure = new Figure();
    this._lastSweepRoom = -100;
  }

  // Called once, right after world.generateNext()/world.reset() produces a
  // new room and the player has stepped into it.
  onDoorOpened(room, ctx) {
    if (room.isLibrary) {
      initLibrary(room, ctx, this.figure);
      return;
    }
    if (room.isShop || room.isElevator || room.isLobby || room.number < 1) return;

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
    updateJack(dt, ctx);
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
    this._lastSweepRoom = -100;
    resetJack();
  }
}
