// ambient.js — non-lethal "seasoning" scares that make the halls feel haunted
// between the real monster encounters. On a slow, weighted timer this fires ONE
// of a handful of atmosphere beats and disposes it a couple seconds later:
//
//   • Doorway silhouette — a dark humanoid stands in the far doorway and blinks
//     out the instant you look near-directly at it (like real DOORS' fleeting
//     figures that vanish when you turn to face them).
//   • Watching portrait — a pair of faint glowing eyes open on a side wall and
//     subtly track you before fading, evoking the paintings whose eyes follow.
//   • Whisper + flicker — a whisper with nothing there, and (if the room's lamps
//     are reachable) a brief dim/flicker that always restores itself.
//   • Darting shadow — a low dark shape streaks across the room ahead and is gone.
//
// Nothing here can damage the player. It only runs in normal play (never in the
// shop/elevator/lobby/library, never while hidden or dead), and biases the
// eerier visual beats toward dark rooms. At most one beat exists at a time and
// each cleans up all of its own geometry/materials (and any borrowed lights).

import * as THREE from '../../vendor/three.module.min.js';
import { CFG } from '../config.js';
import { rand, chance, choice, clamp, toWorld } from '../utils.js';
import { Sfx } from '../audio.js';
import { sceneFromCtx } from './sceneUtil.js';

// ---- tunables ---------------------------------------------------------------
const FIRST_DELAY = [16, 28];     // seconds before the first possible beat
const NEXT_DELAY = [22, 44];      // seconds between rolls (seasoning, not spam)

const SILHOUETTE_LIFE = 2.4;      // seconds on screen if never looked at
const SILHOUETTE_FADE_IN = 0.5;
const SILHOUETTE_FADE_OUT = 0.18; // quick blink-out
const SILHOUETTE_LOOK_DOT = 0.9;  // how directly you must look to banish it
const SILHOUETTE_MIN_DIST = 7;    // needs standoff room to read (else -> whisper)

const EYES_LIFE = 3.8;
const EYES_FADE_IN = 0.8;
const EYES_FADE_OUT = 1.0;
const EYES_TRACK_LAG = 3.2;       // how lazily the gaze follows you

const WHISPER_LIFE = 2.4;
const DIM_FACTOR = 0.16;          // baseline lamp dim during the flicker

const SHADOW_LIFE = 1.05;
const SHADOW_FADE_IN = 0.15;
const SHADOW_FADE_OUT = 0.28;
const SHADOW_AHEAD = 9;           // how far in front of you it crosses
const SHADOW_SPAN = 8;            // half-width of its dash

const DARK_COLOR = 0x060608;
const EYE_COLOR = 0xf2e2a8;

export class AmbientScares {
  constructor() {
    this._timer = rand(FIRST_DELAY[0], FIRST_DELAY[1]);
    this._active = null; // the one live beat, or null
  }

  update(dt, ctx) {
    if (this._active) this._tick(dt, ctx);

    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = rand(NEXT_DELAY[0], NEXT_DELAY[1]);
      if (!this._active) {
        const room = this._eligibleRoom(ctx);
        if (room) this._fire(ctx, room);
      }
    }
  }

  reset() {
    if (this._active) this._endBeat();
    this._timer = rand(FIRST_DELAY[0], FIRST_DELAY[1]);
  }

  // ---- eligibility ----------------------------------------------------------
  _eligibleRoom(ctx) {
    const p = ctx.player;
    if (!p || p.hiddenIn || p.dead) return null;
    const room = ctx.world.getRoomAt(p.pos.x, p.pos.y, p.pos.z);
    if (!room) return null;
    if (room.isShop || room.isElevator || room.isLobby || room.isLibrary) return null;
    if (room.number != null && room.number < 1) return null;
    return room;
  }

  // ---- firing ---------------------------------------------------------------
  _fire(ctx, room) {
    const scene = sceneFromCtx(ctx);
    if (!scene) return;

    const dark = !!room.dark;
    // Dark rooms lean toward the eerier *visual* beats; lit rooms lean toward
    // the whisper/flicker (which needs working lamps to show at all).
    const table = dark
      ? [['silhouette', 3], ['eyes', 3], ['shadow', 2], ['whisper', 2]]
      : [['whisper', 3], ['shadow', 2], ['silhouette', 2], ['eyes', 2]];
    const kind = this._weighted(table);

    let beat = null;
    if (kind === 'silhouette') beat = this._spawnSilhouette(ctx, room, scene);
    else if (kind === 'eyes') beat = this._spawnEyes(ctx, room, scene);
    else if (kind === 'shadow') beat = this._spawnShadow(ctx, room, scene);
    // whisper is also the fallback when a positional beat can't place itself
    if (!beat) beat = this._spawnWhisper(ctx, room, scene);

    this._active = beat;
  }

  _weighted(table) {
    let total = 0;
    for (const entry of table) total += entry[1];
    let r = Math.random() * total;
    for (const entry of table) {
      r -= entry[1];
      if (r <= 0) return entry[0];
    }
    return table[0][0];
  }

  // ---- the shared per-frame tick -------------------------------------------
  _tick(dt, ctx) {
    const beat = this._active;
    beat.t += dt;

    // banish-on-look (silhouette): the moment the gaze lands near-directly on
    // it, start its quick blink-out.
    if (beat.vanishOnLook && !beat._vanishing && beat.pos) {
      const p = ctx.player;
      const ex = beat.pos.x - p.pos.x;
      const ey = beat.pos.y - p.eyeY;
      const ez = beat.pos.z - p.pos.z;
      const d = Math.hypot(ex, ey, ez);
      if (d > 0.001) {
        const look = p.lookVec3();
        const dot = (look.x * ex + look.y * ey + look.z * ez) / d;
        if (dot > SILHOUETTE_LOOK_DOT) {
          beat._vanishing = true;
          beat.t = Math.max(beat.t, beat.life - beat.fadeOut);
        }
      }
    }

    if (beat.onTick) beat.onTick(dt, ctx, beat);

    // opacity envelope (visual beats only — whisper carries no material)
    if (beat.mats.length) {
      let env;
      if (beat.t < beat.fadeIn) env = beat.t / beat.fadeIn;
      else if (beat.t > beat.life - beat.fadeOut) env = Math.max(0, (beat.life - beat.t) / beat.fadeOut);
      else env = 1;
      const o = env * beat.baseOpacity;
      for (const m of beat.mats) m.opacity = o;
    }

    if (beat.t >= beat.life) this._endBeat();
  }

  _endBeat() {
    const beat = this._active;
    this._active = null;
    if (!beat) return;
    if (beat.restore) { try { beat.restore(); } catch (_) { /* lights detached */ } }
    if (beat.mesh && beat.mesh.parent) beat.mesh.parent.remove(beat.mesh);
    for (const g of beat.geos) { try { g.dispose(); } catch (_) { /* already gone */ } }
    for (const m of beat.mats) { try { m.dispose(); } catch (_) { /* already gone */ } }
  }

  // ---- beat: doorway silhouette --------------------------------------------
  _spawnSilhouette(ctx, room, scene) {
    const anchor = room.pathNodes && room.pathNodes[1];
    if (!anchor) return null;
    const p = ctx.player;
    if (Math.hypot(anchor.x - p.pos.x, anchor.z - p.pos.z) < SILHOUETTE_MIN_DIST) return null;

    const mat = new THREE.MeshBasicMaterial({ color: DARK_COLOR, transparent: true, opacity: 0, depthWrite: false });
    const group = new THREE.Group();
    const torsoGeo = new THREE.CapsuleGeometry(0.95, 3.2, 4, 10);
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 3.1;
    const headGeo = new THREE.SphereGeometry(0.72, 10, 8);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 5.5;
    group.add(torso, head);
    group.position.set(anchor.x, 0, anchor.z);
    scene.add(group);

    return {
      kind: 'silhouette', t: 0, life: SILHOUETTE_LIFE,
      fadeIn: SILHOUETTE_FADE_IN, fadeOut: SILHOUETTE_FADE_OUT, baseOpacity: 0.96,
      mesh: group, geos: [torsoGeo, headGeo], mats: [mat],
      pos: { x: anchor.x, y: 3.6, z: anchor.z }, vanishOnLook: true, _vanishing: false,
      onTick: null, restore: null,
    };
  }

  // ---- beat: watching portrait eyes ----------------------------------------
  _spawnEyes(ctx, room, scene) {
    const frame = room.frame;
    if (!frame) return null;
    const W = CFG.room.W;
    const len = room.length || 30;
    const side = choice([-1, 1]);
    const localX = side * (W / 2 - 0.5);
    const zMax = Math.max(7, len - 6);
    const zMin = Math.min(len * 0.45, zMax);
    const localZ = rand(zMin, zMax);
    const wp = toWorld(frame, localX, localZ);
    const y = 6.3;

    const mat = new THREE.MeshBasicMaterial({ color: EYE_COLOR, transparent: true, opacity: 0, depthWrite: false });
    const group = new THREE.Group();
    const eyeGeo = new THREE.SphereGeometry(0.15, 8, 6);
    for (const sx of [-0.42, 0.42]) {
      const eye = new THREE.Mesh(eyeGeo, mat);
      eye.position.set(sx, 0, 0);
      eye.scale.set(1.5, 0.85, 0.7); // narrowed to read as eyes, not dots
      group.add(eye);
    }
    group.position.set(wp.x, y, wp.z);
    const yaw0 = Math.atan2(ctx.player.pos.x - wp.x, ctx.player.pos.z - wp.z);
    group.rotation.y = yaw0;
    scene.add(group);

    return {
      kind: 'eyes', t: 0, life: EYES_LIFE,
      fadeIn: EYES_FADE_IN, fadeOut: EYES_FADE_OUT, baseOpacity: 0.85,
      mesh: group, geos: [eyeGeo], mats: [mat],
      pos: null, vanishOnLook: false, _yaw: yaw0,
      onTick: (dt, c, b) => {
        const pp = c.player.pos;
        const target = Math.atan2(pp.x - b.mesh.position.x, pp.z - b.mesh.position.z);
        let d = target - b._yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        b._yaw += d * Math.min(1, dt * EYES_TRACK_LAG);
        b.mesh.rotation.y = b._yaw;
      },
      restore: null,
    };
  }

  // ---- beat: darting shadow -------------------------------------------------
  _spawnShadow(ctx, room, scene) {
    const p = ctx.player;
    const f = p.forwardVec();               // {x,z}
    const rx = -f.z, rz = f.x;              // strafe-right
    const cx = p.pos.x + f.x * SHADOW_AHEAD;
    const cz = p.pos.z + f.z * SHADOW_AHEAD;
    const sign = choice([-1, 1]);
    const startX = cx - rx * SHADOW_SPAN * sign, startZ = cz - rz * SHADOW_SPAN * sign;
    const endX = cx + rx * SHADOW_SPAN * sign, endZ = cz + rz * SHADOW_SPAN * sign;

    const mat = new THREE.MeshBasicMaterial({ color: DARK_COLOR, transparent: true, opacity: 0, depthWrite: false });
    const geo = new THREE.SphereGeometry(1.0, 10, 8);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(1.7, 0.85, 1.15);
    mesh.position.set(startX, 1.1, startZ);
    scene.add(mesh);
    Sfx.whoosh(0.3);

    return {
      kind: 'shadow', t: 0, life: SHADOW_LIFE,
      fadeIn: SHADOW_FADE_IN, fadeOut: SHADOW_FADE_OUT, baseOpacity: 0.88,
      mesh, geos: [geo], mats: [mat],
      pos: null, vanishOnLook: false,
      onTick: (dt, c, b) => {
        const k = clamp(b.t / b.life, 0, 1);
        const e = k * k * (3 - 2 * k); // smoothstep across the room
        b.mesh.position.x = startX + (endX - startX) * e;
        b.mesh.position.z = startZ + (endZ - startZ) * e;
        b.mesh.position.y = 1.1 + Math.sin(k * Math.PI) * 0.3;
      },
      restore: null,
    };
  }

  // ---- beat: whisper + flicker ---------------------------------------------
  _spawnWhisper(ctx, room, scene) {
    Sfx.whisper();
    if (ctx.game && ctx.game.caption && chance(0.4)) ctx.game.caption('...');

    // Borrow whatever working lamps this room exposes (defensively — the
    // records' shape is checked and anything unexpected is simply skipped, so
    // a missing/renamed field just means "whisper only, no flicker").
    const recs = [];
    if (Array.isArray(room.lights)) {
      for (const lamp of room.lights) {
        const light = lamp && lamp.light;
        if (light && typeof light.intensity === 'number' && !lamp.broken && light.intensity > 0) {
          recs.push({ light, orig: light.intensity });
        }
      }
    }

    return {
      kind: 'whisper', t: 0, life: WHISPER_LIFE,
      fadeIn: 0.01, fadeOut: 0.01, baseOpacity: 0,
      mesh: null, geos: [], mats: [],
      pos: null, vanishOnLook: false,
      _recs: recs, _flickTimer: 0, _mult: DIM_FACTOR,
      onTick: (dt, c, b) => {
        if (!b._recs.length) return;
        b._flickTimer -= dt;
        if (b._flickTimer <= 0) {
          b._flickTimer = rand(0.06, 0.18);
          // mostly deep dips, occasionally a brief surge back up: reads as a
          // failing bulb rather than a steady dim.
          b._mult = chance(0.3) ? rand(0.55, 0.95) : rand(0.05, 0.22);
          Sfx.flicker(0.5);
        }
        for (const r of b._recs) r.light.intensity = r.orig * b._mult;
      },
      restore: () => { for (const r of recs) r.light.intensity = r.orig; },
    };
  }
}
