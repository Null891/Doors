// jack.js — a closet jumpscare. Rolled when a player enters an eligible
// closet; resolves after a short beat so it lands as a scare rather than an
// instant punish. No per-frame director hook — call updateJack(dt, ctx)
// each frame to drain the pending-timer queue this module owns.

import { CFG } from '../config.js';
import { chance } from '../utils.js';
import { Sfx } from '../audio.js';

const JACK_DAMAGE = 25; // forced-out scare + moderate hit, distinct from Hide's smaller shove

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
    Sfx.bite();
    ctx.hud.scare('jack');
    ctx.game.shake(1.6);
    ctx.player.damage(JACK_DAMAGE);
    if (ctx.player.health <= 0) ctx.game.killPlayer('Jack');
  }
}

export function resetJack() {
  pending = [];
}
