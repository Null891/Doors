// player.js — first-person controller: pointer-lock look, WASD, crouch,
// cylinder-vs-AABB collision, footsteps (which the Figure can hear), health.

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { clamp, damp, resolveCircle } from './utils.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = CFG.player.health;
    this.crouch = false;
    this.hiddenIn = null;   // closet ref while hiding
    this.dead = false;
    this.boostTimer = 0;    // vitamins
    this.sensitivity = 1;
    this._eye = CFG.player.eyeStand;
    this._bobPhase = 0;
    this.bob = 0;
    this._stepAcc = 0;
    this.speedFrac = 0;     // 0..1 how fast we're moving (for bob/audio)
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = CFG.player.health;
    this.crouch = false;
    this.hiddenIn = null;
    this.dead = false;
    this.boostTimer = 0;
    this._eye = CFG.player.eyeStand;
    this.speedFrac = 0;
  }

  get eyeY() { return this._eye + this.bob; }

  forwardVec() {
    // camera looks along (-sin(yaw), -cos(yaw)) on XZ when pitch = 0
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  lookVec3() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );
  }

  // returns distance moved this frame (0 while hidden)
  update(dt, colliders, game) {
    if (this.dead) return 0;

    // ---- look ----
    const { dx, dy } = Input.consumeMouse();
    const s = 0.0022 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.45, 1.45);

    this.boostTimer = Math.max(0, this.boostTimer - dt);

    if (this.hiddenIn) {
      // locked in a closet: look only
      this.speedFrac = 0;
      this.bob = damp(this.bob, 0, 10, dt);
      this._eye = damp(this._eye, CFG.player.eyeStand, 8, dt);
      return 0;
    }

    // ---- crouch ----
    if (Input.pressed('KeyC')) this.crouch = !this.crouch;
    const forcedCrouch = Input.down('ControlLeft') || Input.down('ControlRight');
    const crouched = this.crouch || forcedCrouch;
    this._eye = damp(this._eye, crouched ? CFG.player.eyeCrouch : CFG.player.eyeStand, 10, dt);

    // ---- move ----
    let mx = 0, mz = 0;
    if (Input.down('KeyW') || Input.down('ArrowUp')) mz += 1;
    if (Input.down('KeyS') || Input.down('ArrowDown')) mz -= 1;
    if (Input.down('KeyA') || Input.down('ArrowLeft')) mx -= 1;
    if (Input.down('KeyD') || Input.down('ArrowRight')) mx += 1;

    let moved = 0;
    if (mx !== 0 || mz !== 0) {
      const inv = 1 / Math.hypot(mx, mz);
      mx *= inv; mz *= inv;
      const f = this.forwardVec();
      const rx = -f.z, rz = f.x; // strafe right
      let speed = CFG.player.walk + (this.boostTimer > 0 ? CFG.items.vitaminsBoost : 0);
      if (crouched) speed *= CFG.player.crouchMult;

      const vx = (f.x * mz + rx * mx) * speed;
      const vz = (f.z * mz + rz * mx) * speed;
      const oldX = this.pos.x, oldZ = this.pos.z;
      const res = resolveCircle(
        this.pos.x + vx * dt, this.pos.z + vz * dt,
        CFG.player.radius, 0.3, 4.6, colliders,
      );
      this.pos.x = res.x;
      this.pos.z = res.z;
      moved = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);

      // footsteps
      this._stepAcc += moved;
      if (this._stepAcc >= CFG.player.stepLen) {
        this._stepAcc = 0;
        Sfx.step(crouched);
        game?.onFootstep?.(crouched);
      }
    }

    this.isCrouched = crouched;
    this.speedFrac = damp(this.speedFrac, moved > 0.001 ? 1 : 0, 8, dt);
    this._bobPhase += moved * 0.55;
    this.bob = Math.sin(this._bobPhase) * 0.14 * this.speedFrac;
    return moved;
  }

  applyCamera(camera, shakeAmp) {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw + (Math.random() - 0.5) * shakeAmp * 0.06;
    camera.rotation.x = this.pitch + (Math.random() - 0.5) * shakeAmp * 0.06;
    camera.rotation.z = (Math.random() - 0.5) * shakeAmp * 0.03;
    camera.position.set(this.pos.x, this.eyeY, this.pos.z);
  }

  damage(n) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - n);
  }

  heal(n) {
    this.health = Math.min(CFG.player.health, this.health + n);
  }
}
