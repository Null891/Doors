// jack.js — a closet jumpscare. Rolled when a player enters an eligible
// closet; resolves after a short beat so it lands as a scare rather than an
// instant punish. No per-frame director hook — call updateJack(dt, ctx)
// each frame to drain the pending-timer queue this module owns.
//
// Per the wiki, the real Jack "deals no damage" — its cost is purely the
// fright and getting forced back out into the open (its closet slams shut
// on you and won't open again until re-tried), not a health hit. Damage was
// removed here to match; the sting/shake/HUD scare are kept for the fright.

import { CFG } from '../config.js';
import { chance } from '../utils.js';
import { Sfx } from '../audio.js';

let pending = [];

export function maybeTriggerJack(closetRecord, room, ctx) {
  if (room.number < CFG.jack.minRoom) return;
  if (!chance(CFG.jack.chance)) return;
  pending.push({ closet: closetRecord, timer: 0.5 });
}

export function updateJack(dt, ctx) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    p.timer -= dt;
    if (p.timer > 0) continue;
    pending.splice(i, 1);
    if (ctx.player.hiddenIn !== p.closet) continue; // already left on their own
    ctx.game.toggleHide(p.closet);
    Sfx.doorSlam(0.9);
    ctx.hud.scare('jack');
    ctx.game.shake(1.6);
  }
}

export function resetJack() {
  pending = [];
}
