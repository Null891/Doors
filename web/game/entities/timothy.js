// timothy.js — the closet "drawer spider". Mirrors jack.js's shape (a
// module-level pending queue drained by updateTimothy each frame, plus a
// resetTimothy) but is a pure fright rather than a punish: a small spider
// leaps out of the closet at your face, screeches, and is gone in under a
// second. It does NOT force you out of the closet (that's Jack's thing).
//
// Grounded in the real DOORS: Timothy ("Spider" in the game files) is a
// small black spider with eight thin moldy legs, light-green eyes and two
// fangs that jumps at you when you open a container. Classically a jumpscare
// only (no death); a later update let him take a small 5-HP nibble unless
// you're already low. We reproduce that: harmless, never lethal, hard-floored
// at 1 HP.

import * as THREE from '../../vendor/three.module.min.js';
import { chance } from '../utils.js';
import { Sfx } from '../audio.js';
import { sceneFromCtx } from './sceneUtil.js';

// ---- tunables --------------------------------------------------------
// Real DOORS rolls ~1/200 per container opened. That's far too rare to ever
// be seen in a short web session, so this is tuned up to "rare but real"
// (still rarer than Jack's 0.09). Room gate keeps him out of the lobby.
const TIMOTHY_CHANCE = 0.06;
const MIN_ROOM = 2;
const BEAT = 0.35;        // pause after entering before he springs
const LUNGE_TIME = 0.5;   // seconds spent pouncing at the face
const HOLD_TIME = 0.32;   // seconds spent flailing at the face before he's gone
const START_DIST = 2.4;   // how far in front of the eye he starts
const END_DIST = 0.55;    // how close to the face he ends
const START_DROP = 0.55;  // he launches from lower down, then rises into view
const NIBBLE = 4;         // tiny modern-Timothy bite; never drops you below this
const HP_FLOOR = 1;       // health can never fall below this from Timothy

let pending = [];   // [{ closet, timer }]
let active = [];    // live spider instances mid-animation

// ---- mesh ------------------------------------------------------------
// A dark two-segment body (abdomen + cephalothorax), a cluster of light-green
// eyes and two pale fangs on the head, and eight thin leg boxes on splayed
// pivots so they can scuttle. Everything unique is tracked in geos/mats for
// disposal; nested pivot Groups hold no GPU resources and need none.
function buildSpider() {
  const group = new THREE.Group();
  const geos = [];
  const mats = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.75, metalness: 0.08 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x161409, roughness: 0.9, metalness: 0.02 }); // moldy dark
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9dff5a }); // light green, self-lit
  const fangMat = new THREE.MeshBasicMaterial({ color: 0xd9d4bc });
  mats.push(bodyMat, legMat, eyeMat, fangMat);

  // abdomen (rear, larger) — squashed and slightly elongated
  const abdGeo = new THREE.SphereGeometry(0.34, 10, 8);
  const abd = new THREE.Mesh(abdGeo, bodyMat);
  abd.position.set(0, 0, -0.24);
  abd.scale.set(1.0, 0.85, 1.2);
  group.add(abd);
  geos.push(abdGeo);

  // cephalothorax (front / head)
  const headGeo = new THREE.SphereGeometry(0.24, 10, 8);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.set(0, 0.02, 0.2);
  group.add(head);
  geos.push(headGeo);

  // eyes: a small forward-facing cluster
  const eyeGeo = new THREE.SphereGeometry(0.05, 6, 5);
  geos.push(eyeGeo);
  const eyeOffsets = [[-0.1, 0.06], [0.1, 0.06], [-0.05, 0.13], [0.05, 0.13]];
  for (const [ex, ey] of eyeOffsets) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(ex, ey, 0.4);
    group.add(e);
  }

  // fangs: two pale cones pointing down/forward under the eyes
  const fangGeo = new THREE.ConeGeometry(0.035, 0.15, 5);
  geos.push(fangGeo);
  for (const fx of [-0.07, 0.07]) {
    const f = new THREE.Mesh(fangGeo, fangMat);
    f.position.set(fx, -0.09, 0.4);
    f.rotation.x = Math.PI * 0.9; // tips angled forward and down
    group.add(f);
  }

  // 8 legs on splayed pivots (4 per side), each a thin bent box
  const legGeo = new THREE.BoxGeometry(0.05, 0.05, 0.85);
  geos.push(legGeo);
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const k = i % 4; // 0 = frontmost .. 3 = rearmost
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, -0.02, 0.18 - k * 0.13);
    pivot.rotation.y = side * (0.95 - k * 0.14); // fan front-to-back
    const baseZ = side * 0.55;                    // lift the shoulders up
    pivot.rotation.z = baseZ;
    group.add(pivot);
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(0, -0.26, 0.4); // knee-bend: reach out then down
    leg.rotation.x = -0.6;
    pivot.add(leg);
    legs.push({ pivot, baseZ, side, phase: i * 0.8 });
  }

  return { group, geos, mats, legs };
}

// ---- public API ------------------------------------------------------
export function maybeTriggerTimothy(closetRecord, room, ctx) {
  if (!room || room.number < MIN_ROOM) return;
  if (!chance(TIMOTHY_CHANCE)) return;
  pending.push({ closet: closetRecord, timer: BEAT });
}

export function updateTimothy(dt, ctx) {
  // drain the pending queue: fire once the short beat elapses
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    p.timer -= dt;
    if (p.timer > 0) continue;
    pending.splice(i, 1);
    // he springs only if you're still in that closet staring into it
    if (ctx.player.hiddenIn !== p.closet) continue;
    fire(ctx);
  }

  // advance any live spiders through lunge -> hold -> despawn
  for (let i = active.length - 1; i >= 0; i--) {
    const inst = active[i];
    inst.t += dt;
    animate(inst);
    if (inst.t >= LUNGE_TIME + HOLD_TIME) despawnAt(i);
  }
}

export function resetTimothy() {
  pending = [];
  for (let i = active.length - 1; i >= 0; i--) despawnAt(i);
  active = [];
}

// ---- internals -------------------------------------------------------
function fire(ctx) {
  const scene = sceneFromCtx(ctx);
  if (!scene) return; // no live rooms to parent into; skip the visual

  const player = ctx.player;
  const look = player.lookVec3(); // unit vector, one allocation at spawn only
  const px = player.pos.x, pz = player.pos.z, py = player.eyeY;

  const spider = buildSpider();
  // start out in front and lower; end right up at the face
  const s = { x: px + look.x * START_DIST, y: py + look.y * START_DIST - START_DROP, z: pz + look.z * START_DIST };
  const e = { x: px + look.x * END_DIST, y: py + look.y * END_DIST - 0.05, z: pz + look.z * END_DIST };
  spider.group.position.set(s.x, s.y, s.z);
  // face the player: local +z (head) points back toward the camera
  spider.group.rotation.y = Math.atan2(-look.x, -look.z);
  spider.group.scale.setScalar(0.5);
  scene.add(spider.group);

  active.push({ ...spider, s, e, t: 0 });

  // fright stack: dedicated spider screech + lunge whoosh + a shake, the HUD
  // scare face and a toast. A small, hard-floored nibble mirrors modern Timothy.
  Sfx.timothyScreech();
  Sfx.whoosh(0.85);
  ctx.game.shake(1.0);
  ctx.hud.scare('timothy');
  ctx.hud.toast('Timothy!', '#9dff5a');

  const dmg = Math.min(NIBBLE, Math.max(0, player.health - HP_FLOOR));
  if (dmg > 0) {
    player.damage(dmg);
    Sfx.bite();
  }
}

function animate(inst) {
  const p = inst.t < LUNGE_TIME ? inst.t / LUNGE_TIME : 1;
  const ease = p * p; // accelerate into the face
  const s = inst.s, e = inst.e;
  const g = inst.group;
  g.position.set(
    s.x + (e.x - s.x) * ease,
    s.y + (e.y - s.y) * ease,
    s.z + (e.z - s.z) * ease,
  );
  g.scale.setScalar(0.5 + 0.65 * ease);

  // chaotic pounce wobble, strongest once he's on you
  const holdAmt = inst.t < LUNGE_TIME ? 0 : (inst.t - LUNGE_TIME) / HOLD_TIME;
  g.rotation.z = Math.sin(inst.t * 42) * (0.06 + 0.14 * holdAmt);

  // legs scuttle
  for (const leg of inst.legs) {
    leg.pivot.rotation.z = leg.baseZ + Math.sin(inst.t * 26 + leg.phase) * 0.32 * leg.side;
  }
}

function despawnAt(i) {
  const inst = active[i];
  if (inst.group.parent) inst.group.parent.remove(inst.group);
  for (const g of inst.geos) g.dispose();
  for (const m of inst.mats) m.dispose();
  active.splice(i, 1);
}
