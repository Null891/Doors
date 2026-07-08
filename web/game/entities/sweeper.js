// sweeper.js — the "Sweeper": handles both Rush and Ambush. A menacing core
// that flickers every lamp, then charges the whole corridor in a straight
// line along the concatenated room path nodes. Rush shatters lamps as it
// enters each room; Ambush skips lamp-breaking but ricochets back and forth.

import * as THREE from '../../vendor/three.module.min.js';
import { CFG } from '../config.js';
import { rand, randInt, chance, clamp, dist2d } from '../utils.js';
import { Sfx } from '../audio.js';
import { Mats } from '../textures.js';
import { breakLamp } from '../rooms.js';
import { sceneFromCtx } from './sceneUtil.js';

const CHEST = 5;

export class Sweeper {
  constructor() {
    this._active = false;
    this.phase = 'idle';
    this.reset();
  }

  get active() { return this._active; }

  trigger(variant) {
    if (this._active) return;
    this._active = true;
    this.variant = variant === 'Ambush' ? 'Ambush' : 'Rush';
    this.cfg = this.variant === 'Ambush' ? CFG.ambush : CFG.rush;
    this.phase = 'warn';
    this.warnTimer = this.cfg.warnTime;
    this._setup = false;
    this._killed = false;
    this._passesLeft = this.variant === 'Ambush'
      ? randInt(CFG.ambush.reboundsMin, CFG.ambush.reboundsMax)
      : 0;
    this._reversed = false;
  }

  reset() {
    this._teardownMesh();
    if (this.loop) { try { this.loop.stop(); } catch (_) { /* noop */ } this.loop = null; }
    this._restoreLamps();
    this._lamps = [];
    this._brokenRooms = new Set();
    this._active = false;
    this.phase = 'idle';
    this.scene = null;
  }

  update(dt, ctx) {
    if (!this._active) return;
    if (this.phase === 'warn') this._warn(dt, ctx);
    else if (this.phase === 'travel') this._travel(dt, ctx);
    else if (this.phase === 'pause') this._pause(dt, ctx);
  }

  // ---- warning ----------------------------------------------------
  _warn(dt, ctx) {
    if (!this._setup) this._setupWarn(ctx);

    this.warnTimer -= dt;
    const p = clamp(1 - this.warnTimer / Math.max(this.cfg.warnTime, 0.001), 0, 1);
    if (this.loop) this.loop.setVol(p * 0.9);

    this._flickTimer -= dt;
    if (this._flickTimer <= 0) {
      this._flickTimer = rand(0.05, 0.13);
      this._flickOn = !this._flickOn;
      this._applyFlicker(this._flickOn);
      // the bulb-buzz cue only makes sense alongside an actual visual
      // flicker, which Ambush no longer has (see _setupWarn) — Rush only.
      if (this.variant === 'Rush' && chance(0.4)) Sfx.flicker(0.6);
    }

    this._shakeAcc -= dt;
    if (this._shakeAcc <= 0) { this._shakeAcc = 0.35; ctx.game.shake(0.4); }

    if (this.warnTimer <= 0) {
      this._restoreLamps();
      this._beginPass(ctx);
    }
  }

  _setupWarn(ctx) {
    this._setup = true;
    this.scene = sceneFromCtx(ctx);
    this._lamps = [];
    // Real DOORS' Ambush stopped flickering lights as a warning as of the
    // Hotel+ update — it's audio-only now (its scream/rumble), while Rush
    // still gets the light-flicker tell. So only Rush collects lamps here;
    // for Ambush this stays empty and _applyFlicker()/_restoreLamps() below
    // become harmless no-ops.
    if (this.variant === 'Rush') {
      for (const room of ctx.world.getActiveRooms()) {
        if (!room.lights) continue;
        for (const rec of room.lights) {
          if (rec.broken) continue;
          this._lamps.push({
            rec,
            origInt: rec.light ? rec.light.intensity : 0,
            origMat: rec.mesh ? rec.mesh.material : null,
          });
        }
      }
    }
    this.loop = Sfx.rushLoop();
    if (this.loop) this.loop.setVol(0);
    this._flickOn = true;
    this._flickTimer = 0;
    this._shakeAcc = 0;
    ctx.game.caption(this.variant === 'Ambush'
      ? 'Something screams in the dark...'
      : 'The lights are dying. RUN or HIDE.');
  }

  _applyFlicker(on) {
    for (const l of this._lamps) {
      if (l.rec.broken) continue;
      if (l.rec.light) l.rec.light.intensity = on ? l.origInt : 0;
      if (l.rec.mesh) l.rec.mesh.material = on ? l.origMat : Mats.bulbOff;
    }
  }

  _restoreLamps() {
    if (!this._lamps) return;
    for (const l of this._lamps) {
      if (l.rec.broken) continue;
      if (l.rec.light) l.rec.light.intensity = l.origInt;
      if (l.rec.mesh && l.origMat) l.rec.mesh.material = l.origMat;
    }
  }

  // ---- travelling -------------------------------------------------
  _beginPass(ctx) {
    if (!this.scene) this.scene = sceneFromCtx(ctx);
    this.path = this._buildPath(ctx, this._reversed);
    if (!this.path || this.path.length < 2 || !this.scene) { this._finish(ctx); return; }
    if (!this.mesh) this._buildMesh();
    this.mesh.visible = true;
    this.segIdx = 0;
    this.travelPos = { x: this.path[0].x, y: this.path[0].y, z: this.path[0].z };
    this.mesh.position.set(this.travelPos.x, this.travelPos.y, this.travelPos.z);
    this._brokenRooms = new Set();
    this.phase = 'travel';
    if (this.variant === 'Ambush') Sfx.ambushScream();
  }

  _buildPath(ctx, reversed) {
    const rooms = ctx.world.getActiveRooms();
    const pts = [];
    for (const r of rooms) {
      if (!r.pathNodes) continue;
      for (const n of r.pathNodes) pts.push({ x: n.x, y: n.y != null ? n.y : CHEST, z: n.z });
    }
    if (pts.length < 2) return null;
    if (reversed) pts.reverse();
    // overshoot beyond the final node in the last segment's direction
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const over = this.cfg.overshoot != null ? this.cfg.overshoot : CFG.rush.overshoot;
    pts.push({ x: b.x + (dx / len) * over, y: b.y + (dy / len) * over, z: b.z + (dz / len) * over });
    return pts;
  }

  // An elongated, hunched shadow-shape with a shrinking trail of "wisps"
  // behind it — reads as a mass tearing through the hallway rather than a
  // ball sliding along a rail. _travel() faces it toward its actual
  // movement direction and pulses the wisps each frame.
  _buildMesh() {
    const grp = new THREE.Group();
    this._geos = [];
    this._mats = [];
    const isAmbush = this.variant === 'Ambush';
    const bodyMat = new THREE.MeshBasicMaterial({ color: isAmbush ? 0x08120a : 0x0a0a0d });
    this._mats.push(bodyMat);

    const bodyGeo = new THREE.SphereGeometry(2.2, 14, 10);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.set(1, 0.82, 1.55);
    grp.add(body);
    this._geos.push(bodyGeo);

    const wispGeo = new THREE.SphereGeometry(1, 8, 6);
    this._geos.push(wispGeo);
    this._wisps = [];
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(wispGeo, bodyMat);
      w.scale.setScalar(0.85 - i * 0.22);
      w.position.z = 2.1 + i * 1.5;
      grp.add(w);
      this._wisps.push(w);
    }

    const eyeGeo = new THREE.SphereGeometry(0.4, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: isAmbush ? 0x8dff9d : 0xe8e8f2 });
    this._geos.push(eyeGeo);
    this._mats.push(eyeMat);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.scale.set(0.55, 1.3, 1);
      e.position.set(sx * 0.8, 0.45, -2.5);
      grp.add(e);
    }

    grp.renderOrder = 5;
    this.mesh = grp;
    this.scene.add(grp);
  }

  _travel(dt, ctx) {
    const prevPos = { x: this.travelPos.x, z: this.travelPos.z };
    let budget = this.cfg.speed * dt;
    const path = this.path;
    while (budget > 0 && this.segIdx < path.length - 1) {
      const a = this.travelPos, b = path[this.segIdx + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const segLen = Math.hypot(dx, dy, dz);
      if (segLen < 1e-4) { this.segIdx++; continue; }
      if (budget >= segLen) {
        this.travelPos = { x: b.x, y: b.y, z: b.z };
        budget -= segLen;
        this.segIdx++;
      } else {
        const f = budget / segLen;
        this.travelPos = { x: a.x + dx * f, y: a.y + dy * f, z: a.z + dz * f };
        budget = 0;
      }
    }
    this.mesh.position.set(this.travelPos.x, this.travelPos.y, this.travelPos.z);

    // face the actual direction moved this frame (robust through corners),
    // and writhe/pulse the trailing wisps for a "shadow tearing through
    // the hallway" read instead of a static ball sliding along a rail
    const fdx = this.travelPos.x - prevPos.x, fdz = this.travelPos.z - prevPos.z;
    if (Math.hypot(fdx, fdz) > 0.001) this.mesh.rotation.y = Math.atan2(fdx, fdz);
    this._animT = (this._animT || 0) + dt;
    if (this._wisps) {
      this._wisps.forEach((w, i) => {
        const s = (0.85 - i * 0.22) * (1 + Math.sin(this._animT * 14 + i * 2) * 0.12);
        w.scale.setScalar(Math.max(0.15, s));
      });
    }

    if (this.loop && this.loop.setDistance) {
      const d = dist2d(this.travelPos.x, this.travelPos.z, ctx.player.pos.x, ctx.player.pos.z);
      this.loop.setDistance(clamp(1 - d / 55, 0, 1));
    }

    // Both variants shatter the lights of rooms they tear through — for
    // Rush it's part of the same warning-then-charge; Ambush shatters them
    // as a consequence of the charge itself, since it skips the pre-charge
    // flicker warning Rush gets (per the wiki: "the lights in the next room
    // will then break" as Ambush moves through).
    const room = ctx.world.getRoomAt(this.travelPos.x, this.travelPos.y, this.travelPos.z);
    if (room && room.lights && !this._brokenRooms.has(room)) {
      this._brokenRooms.add(room);
      let broke = false;
      for (const lamp of room.lights) {
        if (!lamp.broken) { breakLamp(lamp); broke = true; }
      }
      if (broke) Sfx.shatter(0.7);
    }

    if (this._checkKill(ctx)) return;

    if (this.segIdx >= path.length - 1) {
      if (this.variant === 'Ambush' && this._passesLeft > 0) {
        this.phase = 'pause';
        this.pauseTimer = rand(CFG.ambush.pauseMin, CFG.ambush.pauseMax);
        this.mesh.visible = false;
      } else {
        this._finish(ctx);
      }
    }
  }

  _checkKill(ctx) {
    if (this._killed) return false;
    const player = ctx.player;
    if (player.hiddenIn || player.dead) return false;
    const d = dist2d(this.travelPos.x, this.travelPos.z, player.pos.x, player.pos.z);
    if (d > this.cfg.killDist) return false;

    if (ctx.inventory && ctx.inventory.hasCrucifix && ctx.inventory.hasCrucifix()) {
      ctx.inventory.consumeCrucifix();
      Sfx.crucifixBanish();
      ctx.game.notify('The crucifix drove it back!', '#7ec8ff');
      this._finish(ctx);
      return true;
    }
    this._killed = true;
    ctx.game.killPlayer(this.variant);
    ctx.hud.scare(this.variant.toLowerCase());
    this._finish(ctx);
    return true;
  }

  _pause(dt, ctx) {
    this.pauseTimer -= dt;
    if (this.pauseTimer <= 0) {
      this._passesLeft--;
      this._reversed = !this._reversed;
      ctx.game.caption("It's coming back...");
      this._beginPass(ctx);
    }
  }

  // ---- teardown ---------------------------------------------------
  _teardownMesh() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      if (this._geos) for (const g of this._geos) g.dispose();
      if (this._mats) for (const m of this._mats) m.dispose();
      this.mesh = null;
      this._geos = null;
      this._mats = null;
      this._wisps = null;
    }
  }

  _finish(ctx) {
    this._teardownMesh();
    if (this.loop) { try { this.loop.stop(); } catch (_) { /* noop */ } this.loop = null; }
    this._restoreLamps();
    this._lamps = [];
    this._active = false;
    this.phase = 'idle';
  }
}
