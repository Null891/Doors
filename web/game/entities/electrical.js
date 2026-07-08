// electrical.js — Door 100's Circuit Breaker puzzle. Collect all 10 switch
// pickups scattered around the room, then solve a 3-round memory sequence
// at the panel to restore power (which the elevator lever then requires).
// Round 3 always has one "mystery" switch: its identity isn't shown during
// memorization, only that there IS one — its number is the sum of the
// other switches shown that round (matching the real game's rule).

import { CFG } from '../config.js';
import { randInt } from '../utils.js';
import { Sfx } from '../audio.js';

function shuffled(n) {
  const a = [];
  for (let i = 1; i <= n; i++) a.push(i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function initElectrical(room, ctx) {
  if (!room.electricalSwitches || !room.electricalPanel) return;

  const numbers = shuffled(CFG.electrical.switchCount);
  room.electricalSwitches.forEach((sw, i) => { sw.num = numbers[i]; });

  let collectedCount = 0;
  for (const sw of room.electricalSwitches) {
    room.interactables.push({
      pos: sw.promptPos, range: 4,
      getLabel: () => (sw.collected ? null : `Take Breaker Switch #${sw.num}`),
      interact: (ictx) => {
        if (sw.collected) return;
        sw.collected = true;
        sw.mesh.visible = false;
        collectedCount++;
        Sfx.padClick();
        ictx.hud.toast(`Breaker switch ${collectedCount}/${CFG.electrical.switchCount}`, '#7ec8ff');
      },
    });
  }

  let solved = false;
  room.interactables.push({
    pos: room.electricalPanel.promptPos, range: 4.5,
    getLabel: () => (solved ? null
      : collectedCount < CFG.electrical.switchCount
        ? `Breaker Panel (${collectedCount}/${CFG.electrical.switchCount} switches)`
        : 'Circuit Breaker Panel'),
    interact: (ictx) => {
      if (solved) return;
      if (collectedCount < CFG.electrical.switchCount) {
        ictx.hud.toast('Find all the breaker switches first.', '#c33');
        return;
      }
      startPuzzle(ictx, () => {
        solved = true;
        ictx.game.restorePower();
      });
    },
  });
}

// Picks `count` distinct switch numbers. If `mystery` is true, the LAST
// entry is not a free pick — it's forced to equal the sum of the others
// (retried until that sum lands in range and isn't a duplicate), so the
// puzzle is always well-defined and always genuinely has a mystery switch.
function pickTarget(count, mystery, total) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const base = shuffled(total).slice(0, mystery ? count - 1 : count);
    if (!mystery) return { shown: base, hiddenSum: null };
    const sum = base.reduce((a, b) => a + b, 0);
    if (sum >= 1 && sum <= total && !base.includes(sum)) {
      return { shown: base, hiddenSum: sum };
    }
  }
  // fallback: extremely unlikely with 10 switches, but never hang
  const base = shuffled(total).slice(0, count - 1);
  return { shown: base, hiddenSum: null };
}

function startPuzzle(ctx, onSolved) {
  const { hud } = ctx;
  const rounds = CFG.electrical.roundOnCounts.length;
  let round = 0;
  let shown = [];
  let hiddenSum = null;
  let target = new Set();
  let selected = new Set();
  let phase = 'memorize';
  let phaseEndsAt = 0;
  let stopped = false;

  hud.breakerOpen({
    onClick: (num) => {
      if (phase !== 'input') return;
      if (selected.has(num)) selected.delete(num); else selected.add(num);
      renderInput();
    },
    onSubmit: () => {
      if (phase !== 'input') return;
      evaluate();
    },
  });

  // The player can bail via the modal's own LEAVE button, which calls
  // hud.breakerClose() directly — bypassing finish(). Without this guard,
  // our rAF/setTimeout chain would keep running against a closed modal and
  // could still call onSolved() later.
  function stillOpen() {
    if (!hud.breakerVisible) { stopped = true; return false; }
    return true;
  }

  function renderInput() {
    const states = [];
    for (let i = 1; i <= CFG.electrical.switchCount; i++) states.push(selected.has(i));
    hud.breakerSetSwitches(states, true);
  }

  function beginRound() {
    const isMysteryRound = round === rounds - 1;
    const onCount = CFG.electrical.roundOnCounts[round];
    const picked = pickTarget(onCount, isMysteryRound, CFG.electrical.switchCount);
    shown = picked.shown;
    hiddenSum = picked.hiddenSum;
    target = new Set(shown);
    if (hiddenSum != null) target.add(hiddenSum);
    selected = new Set();

    hud.breakerSetRound(round + 1, rounds);
    hud.breakerMsg('');
    beginMemorize();
  }

  function beginMemorize() {
    phase = 'memorize';
    const dur = CFG.electrical.memorizeTime[round];
    phaseEndsAt = performance.now() / 1000 + dur;
    hud.breakerSetStatus(hiddenSum != null
      ? "Memorize the pattern — plus ONE more switch. Its number is the SUM of the others shown."
      : 'Memorize the pattern...');
    const states = [];
    for (let i = 1; i <= CFG.electrical.switchCount; i++) states.push(shown.includes(i));
    hud.breakerSetSwitches(states, false);
    tick();
  }

  function beginInput() {
    phase = 'input';
    const dur = CFG.electrical.inputTime[round];
    phaseEndsAt = performance.now() / 1000 + dur;
    hud.breakerSetStatus('Flip the matching switches, then Submit.');
    renderInput();
    tick();
  }

  function evaluate() {
    if (!stillOpen()) return;
    const ok = selected.size === target.size && [...selected].every((n) => target.has(n));
    if (ok) {
      Sfx.unlock();
      hud.breakerMsg('');
      round++;
      if (round >= rounds) {
        finish();
      } else {
        hud.breakerSetStatus('Correct!');
        setTimeout(() => { if (stillOpen()) beginRound(); }, 900);
      }
    } else {
      Sfx.error();
      hud.breakerMsg('Incorrect — resetting this round.');
      setTimeout(() => { if (stillOpen()) beginRound(); }, 1100);
    }
  }

  function tick() {
    if (!stillOpen()) return;
    const remaining = phaseEndsAt - performance.now() / 1000;
    const total = phase === 'memorize' ? CFG.electrical.memorizeTime[round] : CFG.electrical.inputTime[round];
    hud.breakerSetTimer(Math.max(0, remaining / total));
    if (remaining <= 0) {
      if (phase === 'memorize') {
        beginInput();
      } else {
        evaluate();
      }
      return;
    }
    requestAnimationFrame(tick);
  }

  // Only called on genuine success — leaving early (the modal's own LEAVE
  // button) is handled entirely by stillOpen(), not this function.
  function finish() {
    stopped = true;
    hud.breakerSetStatus('Power restored.');
    hud.breakerMsg('');
    setTimeout(() => { hud.breakerClose(); onSolved(); }, 1000);
  }

  beginRound();
}
