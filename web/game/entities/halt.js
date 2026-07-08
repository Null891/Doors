// halt.js — corridor-chase hazard. Real DOORS' Halt starts BEHIND the
// player and periodically swaps to being in front of them; a brief
// "TURN AROUND" flash marks each swap, and survival requires continuously
// walking away from wherever it currently is — freezing or walking toward
// it lets it close the gap. This deliberately replaced an earlier
// "don't-move-at-all" freeze mechanic, which had it backwards: the real
// entity punishes standing still/wrong-direction movement, not movement
// itself (wiki: "requires constant movement rather than hiding").
//
// There's no dedicated long-hallway room in this codebase's generator, so
// the "corridor" is simulated abstractly: an escape axis is captured from
// the player's facing the moment Halt triggers, and progress along it
// (or against it, once the direction flips) is tracked in world units
// against CFG.halt.corridorLen, split evenly across CFG.halt.phasesMin..Max
// rounds — finally giving those two previously-unused config fields real
// meaning. CFG.halt.speed (Halt's pace vs. the player's own CFG.player.walk)
// sets how much of each segment must actually be covered, since Halt is
// faster than the player and a straight footrace can't be won outright —
// only out-timed round to round.

import { CFG } from '../config.js';
import { rand, randInt, clamp } from '../utils.js';
import { Sfx } from '../audio.js';

const TURN_FLASH = 0.75;        // "TURN AROUND" screen-text duration
const ENTRY_GRACE = [0.7, 1.3]; // silent beat before round 1 (Halt starts behind, unannounced)
const PACE = 1.35;              // reaction-time buffer multiplier on top of a straight-line walk
const LATE_TIGHTEN = 0.05;      // pace shrinks this much per round — Halt gets quicker near the door
const MIN_PACE = 0.95;
const CLOSE_WARN_FRAC = 0.4;    // remaining-time fraction below which a lagging player sees "RUN AWAY"

export class Halt {
  constructor() {
    this._active = false;
    this.phase = 'idle';
  }

  get active() { return this._active; }

  trigger() {
    if (this._active) return;
    this._active = true;
    this._totalRounds = randInt(CFG.halt.phasesMin, CFG.halt.phasesMax);
    this._roundIdx = 0;
    this._segLen = CFG.halt.corridorLen / this._totalRounds;
    // Halt is faster than the player, so only a fraction of each segment is
    // coverable per round — reacting to enough consecutive swaps is what
    // gets you through, not raw speed.
    this._progressFrac = clamp(CFG.player.walk / CFG.halt.speed, 0.35, 0.75);
    this._dir = 1; // +1 = walk further along the escape axis (Halt behind you)
    this._escapeAxis = null;
    this._lastPos = null;
    this.phase = 'entry';
    this._timer = rand(ENTRY_GRACE[0], ENTRY_GRACE[1]);
  }

  update(dt, ctx) {
    if (!this._active) return;
    const player = ctx.player;

    // Hiding is always a valid way to sit out a hazard here (see hide-safety
    // note in other entities) — pause everything and resync lastPos so the
    // in/out closet teleport never reads as a movement sample.
    if (player.hiddenIn) {
      if (this._escapeAxis) this._lastPos = { x: player.pos.x, z: player.pos.z };
      return;
    }

    if (!this._escapeAxis) {
      const f = player.forwardVec();
      this._escapeAxis = { x: f.x, z: f.z };
      this._lastPos = { x: player.pos.x, z: player.pos.z };
    }

    const dx = player.pos.x - this._lastPos.x;
    const dz = player.pos.z - this._lastPos.z;
    this._lastPos = { x: player.pos.x, z: player.pos.z };

    if (this.phase === 'entry') {
      this._timer -= dt;
      if (this._timer <= 0) this._beginRound(ctx);
      return;
    }

    if (this.phase === 'flash') {
      this._timer -= dt;
      if (this._timer <= 0) this._beginRound(ctx);
      return;
    }

    // phase === 'walk'
    this._timer -= dt;
    const proj = (dx * this._escapeAxis.x + dz * this._escapeAxis.z) * this._dir;
    this._roundProgress += proj;
    const need = this._segLen * this._progressFrac;

    if (!this._warnedClose && this._timer < this._roundDuration * CLOSE_WARN_FRAC
        && this._roundProgress < need * 0.5) {
      this._warnedClose = true;
      ctx.hud.bigWarning('RUN AWAY');
      Sfx.flicker(0.8);
    }

    if (this._timer <= 0) {
      if (this._roundProgress >= need) {
        this._roundIdx++;
        if (this._roundIdx >= this._totalRounds) { this._end(); ctx.hud.bigWarning(null); return; }
        this._beginFlash(ctx);
      } else {
        this._violate(ctx);
      }
    }
  }

  _beginFlash(ctx) {
    this.phase = 'flash';
    this._dir *= -1;
    this._timer = TURN_FLASH;
    ctx.hud.bigWarning('TURN AROUND');
    Sfx.whoosh(0.9);
  }

  _beginRound(ctx) {
    this.phase = 'walk';
    const pace = Math.max(MIN_PACE, PACE - this._roundIdx * LATE_TIGHTEN);
    this._roundDuration = Math.max(0.8, (this._segLen / CFG.player.walk) * pace);
    this._timer = this._roundDuration;
    this._roundProgress = 0;
    this._warnedClose = false;
    if (ctx) ctx.hud.bigWarning(null);
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
