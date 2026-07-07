// halt.js — input-freeze hazard for long straight corridors. Shows a huge
// STOP warning for a random window; any movement or camera turn during that
// window is a violation. A few phases per encounter, one strike ends it.

import { CFG } from '../config.js';
import { rand, randInt } from '../utils.js';
import { Sfx } from '../audio.js';

export class Halt {
  constructor() {
    this._active = false;
    this.phase = 'idle';
  }

  get active() { return this._active; }

  trigger() {
    if (this._active) return;
    this._active = true;
    this._phasesLeft = randInt(CFG.halt.phasesMin, CFG.halt.phasesMax);
    this.phase = 'pause';
    this._timer = rand(0.6, 1.4);
  }

  update(dt, ctx) {
    if (!this._active) return;
    const player = ctx.player;

    // Hiding is always a valid way to hold still — and the teleport into a
    // closet (new pos + yaw in one frame) would otherwise read as a
    // movement violation the instant someone ducks for cover.
    if (player.hiddenIn) {
      if (this.phase === 'stop') { this._lastYaw = player.yaw; this._lastPitch = player.pitch; }
      return;
    }

    if (this.phase === 'pause') {
      this._timer -= dt;
      if (this._timer <= 0) this._startStop(ctx);
      return;
    }

    // phase === 'stop'
    this._timer -= dt;
    const dyaw = Math.abs(player.yaw - this._lastYaw);
    const dpitch = Math.abs(player.pitch - this._lastPitch);
    this._lastYaw = player.yaw;
    this._lastPitch = player.pitch;

    if (player.speedFrac > 0.05 || dyaw > 0.012 || dpitch > 0.012) {
      this._violate(ctx);
      return;
    }
    if (this._timer <= 0) {
      this._phasesLeft--;
      ctx.hud.bigWarning(null);
      if (this._phasesLeft <= 0) { this._end(); return; }
      this.phase = 'pause';
      this._timer = rand(0.8, 1.8);
    }
  }

  _startStop(ctx) {
    this.phase = 'stop';
    this._timer = rand(1.1, 2.2);
    this._lastYaw = ctx.player.yaw;
    this._lastPitch = ctx.player.pitch;
    ctx.hud.bigWarning('STOP');
    Sfx.flicker(1);
  }

  _violate(ctx) {
    ctx.hud.bigWarning(null);
    ctx.player.damage(CFG.halt.damage);
    Sfx.sting();
    ctx.hud.scare('halt');
    ctx.game.shake(1.5);
    if (ctx.player.health <= 0) ctx.game.killPlayer('Halt');
    this._end();
  }

  _end() {
    this._active = false;
    this.phase = 'idle';
  }

  reset() {
    this._active = false;
    this.phase = 'idle';
  }
}
