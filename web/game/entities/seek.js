// seek.js — the "Seek" chase. Faithful to DOORS' Seek chase sequences (the
// Grand Hallway / Caverns): the screen is flooded, a black humanoid mass of
// eyes and teeth erupts BEHIND the player, and you must sprint forward
// through door after door while grabbing arms burst from the side walls as
// dressing. Seek plays "cat and mouse" — it paces just under a running
// player's speed and hangs a leash-length behind, but the instant you stall,
// backtrack, or get pinned it closes the gap and takes you. The chase ends
// when you've advanced far enough (the "end door" that Guiding Light slams
// shut in the real game), at which point Seek recedes and despawns.
//
// This game generates rooms on the fly (no scripted corridor), so the corridor
// is approximated with a breadcrumb trail: the mass follows the exact twisting
// path the player has walked, chasing the oldest crumb toward the player's
// live position. Running forward keeps laying fresh crumbs ahead of it;
// stopping lets it consume the trail and reach you.

import * as THREE from '../../vendor/three.module.min.js';
import { rand, clamp, dist2d } from '../utils.js';
import { Sfx } from '../audio.js';
import { sceneFromCtx } from './sceneUtil.js';

// ---- tunables (local; see report for any worth sharing in config.js) ----
const INTRO_TIME = 1.7;       // warning beat before the mass starts pursuing
const SEEK_SPEED = 12.8;      // mass pace along the trail (under player walk=14, so a runner pulls away)
const START_GAP = 18;         // how far behind the player the mass erupts (a ~1s stall buffer)
const KILL_DIST = 4.6;        // caught if the mass closes to within this of the player
const SEEK_ROOMS = 4;         // advance this many doors to reach the "end door" and survive
const SEEK_MAX_TIME = 24;     // hard safety cap on chase length (relief if reached)
const RECEDE_TIME = 1.3;      // mass shrinks/fades away over this on survival
const BREAD_SPACING = 2.5;    // world-unit resolution of the breadcrumb trail
const MASS_RADIUS = 4.2;      // rough visual radius of the eye-mass
const EYE_COUNT = 14;         // glowing eyes studded across the mass

// grabbing-hand dressing
const HAND_POOL = 4;
const HAND_INTERVAL = [1.0, 2.1]; // seconds between arm eruptions
const HAND_AHEAD = 5.5;           // spawns this far ahead of the player along their path
const HAND_SIDE = 11;             // lateral distance out to the side walls
const HAND_REACH = 2.2;           // how far the arm lunges inward from the wall
const HAND_EMERGE = 0.32, HAND_HOLD = 0.55, HAND_RETRACT = 0.5;
const HAND_SCARE_DIST = 3.0;      // brushing an extended arm jolts you (non-lethal dressing)

export class Seek {
  constructor() {
    this._active = false;
    this.phase = 'idle';
    this.scene = null;
    this.mesh = null;
    this._fx = null;
    this._geos = null;
    this._mats = null;
    this._hands = null;
    this._eyes = null;
    this._loop = null;
  }

  get active() { return this._active; }

  trigger() {
    if (this._active) return;
    this._active = true;
    this.phase = 'intro';
    this._setup = false;
    this._killed = false;
    this._elapsed = 0;
    this._introT = INTRO_TIME;
    this._bread = [];
    this._seekIdx = 0;
    this._handTimer = rand(HAND_INTERVAL[0], HAND_INTERVAL[1]) + INTRO_TIME * 0.5;
    this._triggerRoom = 0;
    this._animT = 0;
  }

  update(dt, ctx) {
    if (!this._active) return;
    if (!this._setup) { if (!this._setupChase(ctx)) { this._teardown(); return; } }

    this._elapsed += dt;
    this._animT += dt;

    if (this.phase === 'intro') this._intro(dt, ctx);
    else if (this.phase === 'chase') this._chase(dt, ctx);
    else if (this.phase === 'recede') this._recede(dt, ctx);

    this._animateMass(dt);
    this._updateHands(dt, ctx);
  }

  // ---- setup ------------------------------------------------------
  _setupChase(ctx) {
    this.scene = sceneFromCtx(ctx);
    if (!this.scene) return false;
    this._setup = true;

    const cur = ctx.world.getCurrentRoom();
    this._triggerRoom = cur ? cur.number : 0;

    const player = ctx.player;
    const f = player.forwardVec();
    // erupt START_GAP behind the player, along the corridor they came down
    this._seekPos = {
      x: player.pos.x - f.x * START_GAP,
      z: player.pos.z - f.z * START_GAP,
    };
    this._bread = [];
    this._seekIdx = 0;

    if (!this._fx) this._buildMesh();
    this._fx.visible = true;
    this.mesh.visible = true;
    this.mesh.position.set(this._seekPos.x, MASS_RADIUS * 0.7, this._seekPos.z);
    this.mesh.scale.setScalar(1);

    this._loop = Sfx.rumbleLoop();
    if (this._loop) this._loop.setVol(0.0);

    // flood / erupt cues
    Sfx.growl(1.0);
    Sfx.ambushScream();
    ctx.game.shake(1.6);
    ctx.hud.bigWarning('SEEK IS CHASING');
    ctx.hud.scare('seek');
    ctx.game.caption('SEEK! Run — through the doors, do not stop!');
    return true;
  }

  // ---- intro ------------------------------------------------------
  _intro(dt, ctx) {
    this._introT -= dt;
    // rising rumble + periodic jolts during the warning beat
    if (this._loop) this._loop.setVol(clamp(1 - this._introT / INTRO_TIME, 0, 1) * 0.55);
    this._shakeAcc = (this._shakeAcc || 0) - dt;
    if (this._shakeAcc <= 0) { this._shakeAcc = 0.3; ctx.game.shake(0.5); }
    // still lay a trail so the mass has a path the moment it starts moving
    this._layTrail(ctx.player);
    if (this._introT <= 0) {
      ctx.hud.bigWarning(null);
      this.phase = 'chase';
    }
  }

  // ---- chase ------------------------------------------------------
  _chase(dt, ctx) {
    const player = ctx.player;
    this._layTrail(player);
    this._advanceMass(dt, player);

    // audio pressure scales with closeness
    const d = dist2d(this._seekPos.x, this._seekPos.z, player.pos.x, player.pos.z);
    if (this._loop) this._loop.setVol(clamp(1 - d / (START_GAP * 1.4), 0.15, 1) * 0.95);

    // "it's right behind you" tell when the gap gets dangerous
    if (d < KILL_DIST * 2.4 && !player.dead) {
      if (!this._closeWarned) { this._closeWarned = true; ctx.hud.bigWarning('KEEP RUNNING'); Sfx.whoosh(0.9); }
    } else if (this._closeWarned && d > KILL_DIST * 3.2) {
      this._closeWarned = false; ctx.hud.bigWarning(null);
    }

    if (this._checkKill(ctx, d)) return;

    // survival: reach the "end door" (advanced enough rooms) or out-run the clock
    const cur = ctx.world.getCurrentRoom();
    const advanced = cur ? cur.number - this._triggerRoom : 0;
    if (advanced >= SEEK_ROOMS || this._elapsed >= SEEK_MAX_TIME) {
      this._beginRecede(ctx);
    }
  }

  _layTrail(player) {
    const bx = player.pos.x, bz = player.pos.z;
    const last = this._bread.length ? this._bread[this._bread.length - 1] : null;
    if (!last || dist2d(last.x, last.z, bx, bz) >= BREAD_SPACING) {
      this._bread.push({ x: bx, z: bz });
    }
  }

  // Walk the mass along the breadcrumb trail toward the player. It chases the
  // oldest un-consumed crumb; once it has eaten the whole trail it heads
  // straight for the player's live position (the "closing" moment).
  _advanceMass(dt, player) {
    let budget = SEEK_SPEED * dt;
    const bread = this._bread;
    let guard = 4096;
    while (budget > 0 && guard-- > 0) {
      const onTrail = this._seekIdx < bread.length;
      const target = onTrail ? bread[this._seekIdx] : { x: player.pos.x, z: player.pos.z };
      const dx = target.x - this._seekPos.x, dz = target.z - this._seekPos.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-4) { if (onTrail) { this._seekIdx++; continue; } break; }
      if (onTrail && budget >= segLen) {
        this._seekPos.x = target.x; this._seekPos.z = target.z;
        budget -= segLen; this._seekIdx++;
      } else {
        const step = Math.min(budget, segLen);
        const frac = step / segLen;
        this._seekPos.x += dx * frac; this._seekPos.z += dz * frac;
        budget = 0;
      }
    }
    if (this.mesh) {
      const prevX = this.mesh.position.x, prevZ = this.mesh.position.z;
      this.mesh.position.set(this._seekPos.x, MASS_RADIUS * 0.7, this._seekPos.z);
      const mvx = this._seekPos.x - prevX, mvz = this._seekPos.z - prevZ;
      if (Math.hypot(mvx, mvz) > 0.001) this.mesh.rotation.y = Math.atan2(mvx, mvz);
    }
  }

  _checkKill(ctx, d) {
    if (this._killed) return false;
    const player = ctx.player;
    if (player.dead) return false;
    if (d > KILL_DIST) return false;

    // Seek does not respect closets — running is the only escape (wiki:
    // hiding does nothing during the chase). A crucifix, however, banishes it.
    if (ctx.inventory && ctx.inventory.hasCrucifix && ctx.inventory.hasCrucifix()) {
      ctx.inventory.consumeCrucifix();
      Sfx.crucifixBanish();
      if (ctx.game.notify) ctx.game.notify('The crucifix drove Seek back!', '#7ec8ff');
      this._beginRecede(ctx);
      return true;
    }
    this._killed = true;
    Sfx.sting();
    ctx.hud.scare('seek');
    ctx.game.shake(2.2);
    ctx.game.killPlayer('Seek');
    this._teardown();
    return true;
  }

  // ---- recede (survived) -----------------------------------------
  _beginRecede(ctx) {
    if (this.phase === 'recede') return;
    this.phase = 'recede';
    this._recedeT = RECEDE_TIME;
    ctx.hud.bigWarning(null);
    ctx.game.caption('The door slams shut. Seek recedes into the dark...');
    this._retractAllHands();
  }

  _recede(dt, ctx) {
    this._recedeT -= dt;
    const k = clamp(this._recedeT / RECEDE_TIME, 0, 1);
    if (this.mesh) this.mesh.scale.setScalar(Math.max(0.02, k));
    if (this._loop) this._loop.setVol(k * 0.6);
    if (this._recedeT <= 0) this._teardown();
  }

  // ---- the eye-mass ----------------------------------------------
  _buildMesh() {
    this._fx = new THREE.Group();
    this._geos = [];
    this._mats = [];
    this.scene.add(this._fx);

    const grp = new THREE.Group();
    // dark writhing body
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x050507 });
    this._mats.push(bodyMat);
    const bodyGeo = new THREE.SphereGeometry(MASS_RADIUS, 18, 14);
    this._geos.push(bodyGeo);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.set(1.05, 1.15, 0.95);
    grp.add(body);

    // trailing wisps so it reads as a mass tearing forward, not a ball
    const wispGeo = new THREE.SphereGeometry(MASS_RADIUS * 0.6, 12, 9);
    this._geos.push(wispGeo);
    this._wisps = [];
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(wispGeo, bodyMat);
      const s = 0.9 - i * 0.22;
      w.scale.setScalar(s);
      w.position.z = MASS_RADIUS * (0.9 + i * 0.85);
      grp.add(w);
      this._wisps.push(w);
    }

    // studded glowing eyes over the front hemisphere
    const eyeGeo = new THREE.SphereGeometry(0.34, 8, 6);
    this._geos.push(eyeGeo);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ea });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x101014 });
    this._mats.push(eyeMat); this._mats.push(pupilMat);
    const pupilGeo = new THREE.SphereGeometry(0.16, 6, 5);
    this._geos.push(pupilGeo);
    this._eyes = [];
    for (let i = 0; i < EYE_COUNT; i++) {
      const theta = rand(-0.9, 0.9);          // vertical spread
      const phi = rand(-1.15, 1.15);          // around the front (-z side faces player)
      const r = MASS_RADIUS * 0.98;
      const ex = Math.sin(phi) * Math.cos(theta) * r;
      const ey = Math.sin(theta) * r;
      const ez = -Math.abs(Math.cos(phi) * Math.cos(theta)) * r; // bias to the front (-z)
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      const sc = rand(0.6, 1.25);
      eye.scale.setScalar(sc);
      eye.position.set(ex, ey, ez);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(0, 0, -0.22);
      eye.add(pupil);
      grp.add(eye);
      this._eyes.push({ mesh: eye, base: sc, ph: rand(0, Math.PI * 2) });
    }

    // a ragged ring of teeth around the leading face
    const toothGeo = new THREE.ConeGeometry(0.28, 1.1, 5);
    this._geos.push(toothGeo);
    const toothMat = new THREE.MeshBasicMaterial({ color: 0xd8d4c4 });
    this._mats.push(toothMat);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const t = new THREE.Mesh(toothGeo, toothMat);
      const rr = MASS_RADIUS * 0.62;
      t.position.set(Math.cos(a) * rr, Math.sin(a) * rr, -MASS_RADIUS * 0.92);
      t.rotation.x = -Math.PI / 2; // point forward (-z)
      t.scale.setScalar(rand(0.7, 1.2));
      grp.add(t);
    }

    grp.renderOrder = 6;
    this.mesh = grp;
    this._fx.add(grp);

    this._buildHands();
  }

  _animateMass(dt) {
    if (!this.mesh) return;
    if (this._wisps) {
      for (let i = 0; i < this._wisps.length; i++) {
        const w = this._wisps[i];
        const base = 0.9 - i * 0.22;
        const s = base * (1 + Math.sin(this._animT * 12 + i * 2.1) * 0.14);
        w.scale.setScalar(Math.max(0.12, s));
      }
    }
    if (this._eyes) {
      for (const e of this._eyes) {
        const s = e.base * (0.82 + Math.abs(Math.sin(this._animT * 3.3 + e.ph)) * 0.5);
        e.mesh.scale.setScalar(s);
      }
    }
  }

  // ---- grabbing-hand dressing ------------------------------------
  _buildHands() {
    // shared geometry/materials across the pool (disposed once in teardown)
    const armMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0e });
    this._mats.push(armMat);
    const armGeo = new THREE.BoxGeometry(0.55, 0.55, 2.4);
    const palmGeo = new THREE.BoxGeometry(0.9, 0.34, 0.9);
    const fingerGeo = new THREE.BoxGeometry(0.16, 0.16, 0.95);
    this._geos.push(armGeo, palmGeo, fingerGeo);

    this._hands = [];
    for (let h = 0; h < HAND_POOL; h++) {
      const hand = new THREE.Group();
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.z = -1.2;
      hand.add(arm);
      const palm = new THREE.Mesh(palmGeo, armMat);
      palm.position.z = 0.1;
      hand.add(palm);
      for (let i = 0; i < 4; i++) {
        const fg = new THREE.Mesh(fingerGeo, armMat);
        fg.position.set(-0.34 + i * 0.22, 0, 0.7);
        fg.rotation.x = -0.35;
        hand.add(fg);
      }
      hand.visible = false;
      hand.renderOrder = 6;
      this._fx.add(hand);
      this._hands.push({ mesh: hand, state: 'idle', t: 0, jolted: false, wall: { x: 0, y: 0, z: 0 }, inx: 0, inz: 0 });
    }
  }

  _spawnHand(ctx) {
    const hand = this._hands && this._hands.find((h) => h.state === 'idle');
    if (!hand) return;
    const player = ctx.player;
    const f = player.forwardVec();
    const rightX = -f.z, rightZ = f.x;
    const side = Math.random() < 0.5 ? -1 : 1;
    const ax = player.pos.x + f.x * HAND_AHEAD + rightX * side * HAND_SIDE;
    const az = player.pos.z + f.z * HAND_AHEAD + rightZ * side * HAND_SIDE;
    hand.wall = { x: ax, y: rand(2.8, 4.4), z: az };
    hand.inx = -rightX * side; // inward = toward the corridor centre
    hand.inz = -rightZ * side;
    hand.mesh.rotation.y = Math.atan2(hand.inx, hand.inz);
    hand.mesh.position.set(ax, hand.wall.y, az);
    hand.mesh.scale.setScalar(0.05);
    hand.mesh.visible = true;
    hand.state = 'emerge';
    hand.t = 0;
    hand.jolted = false;
    Sfx.whoosh(0.7);
  }

  _updateHands(dt, ctx) {
    if (this.phase === 'chase') {
      this._handTimer -= dt;
      if (this._handTimer <= 0) {
        this._handTimer = rand(HAND_INTERVAL[0], HAND_INTERVAL[1]);
        this._spawnHand(ctx);
      }
    }
    if (!this._hands) return;
    const player = ctx.player;
    for (const h of this._hands) {
      if (h.state === 'idle') continue;
      h.t += dt;
      let reachK = 0;
      if (h.state === 'emerge') {
        reachK = clamp(h.t / HAND_EMERGE, 0, 1);
        if (h.t >= HAND_EMERGE) { h.state = 'hold'; h.t = 0; }
      } else if (h.state === 'hold') {
        reachK = 1;
        if (h.t >= HAND_HOLD) { h.state = 'retract'; h.t = 0; }
      } else if (h.state === 'retract') {
        reachK = clamp(1 - h.t / HAND_RETRACT, 0, 1);
        if (h.t >= HAND_RETRACT) { h.state = 'idle'; h.mesh.visible = false; continue; }
      }
      h.mesh.position.set(
        h.wall.x + h.inx * HAND_REACH * reachK,
        h.wall.y,
        h.wall.z + h.inz * HAND_REACH * reachK,
      );
      h.mesh.scale.setScalar(Math.max(0.05, reachK));
      // brushing a fully-lunged arm jolts you (dressing, not lethal)
      if (h.state === 'hold' && !h.jolted && player && !player.dead) {
        const d = dist2d(h.mesh.position.x, h.mesh.position.z, player.pos.x, player.pos.z);
        if (d < HAND_SCARE_DIST) {
          h.jolted = true;
          ctx.game.shake(0.9);
          Sfx.growl(0.5);
        }
      }
    }
  }

  _retractAllHands() {
    if (!this._hands) return;
    for (const h of this._hands) {
      if (h.state !== 'idle') { h.state = 'retract'; h.t = 0; }
    }
  }

  // ---- teardown ---------------------------------------------------
  _teardown() {
    if (this._loop) { try { this._loop.stop(); } catch (_) { /* noop */ } this._loop = null; }
    if (this._fx) {
      if (this._fx.parent) this._fx.parent.remove(this._fx);
      this._fx = null;
    }
    if (this._geos) { for (const g of this._geos) g.dispose(); this._geos = null; }
    if (this._mats) { for (const m of this._mats) m.dispose(); this._mats = null; }
    this.mesh = null;
    this._hands = null;
    this._eyes = null;
    this._wisps = null;
    this._bread = [];
    this._seekIdx = 0;
    this._active = false;
    this.phase = 'idle';
    this._setup = false;
    this.scene = null;
  }

  reset() {
    this._teardown();
  }
}
