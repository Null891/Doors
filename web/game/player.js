// player.js — first-person controller: pointer-lock look, WASD, crouch,
// cylinder-vs-AABB collision, footsteps (which the Figure can hear), health.

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { clamp, damp, resolveCircle } from './utils.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

// ---- movement-feel tunables (candidates for config.js — see report) ---------
// Sprint is a multiplier on the current base walk speed (incl. vitamins), so
// it stacks with boosts. 1.5 turns the 14u/s walk into ~21u/s — noticeably
// quicker without feeling teleporty, matching DOORS' shift-sprint.
const SPRINT_MULT = 1.5;
// Stamina is a 0..1 budget. DRAIN empties a full bar in ~1/DRAIN seconds of
// sprinting; REGEN refills it while not sprinting (faster when standing still).
const STAMINA_DRAIN = 0.19;          // ~5.3s of continuous sprint from full
const STAMINA_REGEN = 0.24;          // ~4.2s to refill while walking/turning
const STAMINA_IDLE_REGEN_MULT = 1.7; // stand still -> refills in ~2.5s
const STAMINA_RECOVER_DELAY = 0.55;  // pause before regen kicks in after sprint
const STAMINA_MIN_TO_SPRINT = 0.15;  // once emptied, must recover past this to sprint again
const SPRINT_FOV_KICK = 6;           // extra degrees of FOV widening at full sprint
const BOB_FREQ_WALK = 0.55;          // head-bob cycles per unit moved (walking)
const BOB_FREQ_SPRINT_ADD = 0.22;    // added to bob freq at full sprint
const BOB_AMP_WALK = 0.16;
const BOB_AMP_SPRINT_ADD = 0.05;     // taller bob while sprinting
const STEP_SPRINT_SCALE = 0.82;      // shorter stride => faster footstep cadence

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
    this._velX = 0;
    this._velZ = 0;
    this.lean = 0;          // camera roll from strafing, applied in applyCamera
    this.fovKick = 0;       // added to base FOV while moving, applied by main.js
    this._wasCrouched = false;
    this.stamina = 1;       // 0..1 sprint budget; main.js feeds it to the HUD
    this.sprinting = false; // true while actively sprinting this frame
    this._staminaRecover = 0;   // countdown before regen resumes after sprinting
    this._staminaLocked = false; // true after fully draining until we recover past threshold
    this._sprintAmt = 0;    // smoothed 0..1 sprint factor for bob/FOV blending
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
    this._velX = 0;
    this._velZ = 0;
    this.lean = 0;
    this.fovKick = 0;
    this._wasCrouched = false;
    this.stamina = 1;
    this.sprinting = false;
    this._staminaRecover = 0;
    this._staminaLocked = false;
    this._sprintAmt = 0;
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
      // locked in a closet: look only, and catch your breath
      this.speedFrac = 0;
      this.sprinting = false;
      this._sprintAmt = damp(this._sprintAmt, 0, 10, dt);
      this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * STAMINA_IDLE_REGEN_MULT * dt);
      if (this.stamina >= STAMINA_MIN_TO_SPRINT) this._staminaLocked = false;
      this.bob = damp(this.bob, 0, 10, dt);
      this._eye = damp(this._eye, CFG.player.eyeStand, 8, dt);
      return 0;
    }

    // ---- crouch ----
    if (Input.pressed('KeyC')) this.crouch = !this.crouch;
    const forcedCrouch = Input.down('ControlLeft') || Input.down('ControlRight');
    const crouched = this.crouch || forcedCrouch;
    if (crouched !== this._wasCrouched) {
      Sfx.crouchToggle(crouched);
      this._wasCrouched = crouched;
    }
    this._eye = damp(this._eye, crouched ? CFG.player.eyeCrouch : CFG.player.eyeStand, 10, dt);

    // ---- move ----
    // Velocity is smoothed toward a target rather than snapping instantly —
    // reads as actual momentum instead of a robotic on/off slide, without
    // being floaty (lambda=16 settles in ~1-2 frames at 60fps).
    let mx = 0, mz = 0;
    if (Input.down('KeyW') || Input.down('ArrowUp')) mz += 1;
    if (Input.down('KeyS') || Input.down('ArrowDown')) mz -= 1;
    if (Input.down('KeyA') || Input.down('ArrowLeft')) mx -= 1;
    if (Input.down('KeyD') || Input.down('ArrowRight')) mx += 1;

    const hasInput = mx !== 0 || mz !== 0;

    // ---- sprint + stamina ----
    // Hold Shift while moving (and not crouched) to sprint. Draining the bar
    // to empty locks sprint until stamina recovers past a threshold, so you
    // can't feather it at 0 — you have to actually let it come back.
    const wantSprint = hasInput && !crouched &&
      (Input.down('ShiftLeft') || Input.down('ShiftRight'));
    if (this._staminaLocked && this.stamina >= STAMINA_MIN_TO_SPRINT) this._staminaLocked = false;
    this.sprinting = wantSprint && !this._staminaLocked && this.stamina > 0;

    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      this._staminaRecover = STAMINA_RECOVER_DELAY;
      if (this.stamina <= 0) this._staminaLocked = true;
    } else {
      this._staminaRecover = Math.max(0, this._staminaRecover - dt);
      if (this._staminaRecover <= 0 && this.stamina < 1) {
        const mult = hasInput ? 1 : STAMINA_IDLE_REGEN_MULT; // refill faster when still
        this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * mult * dt);
      }
    }
    // smoothed sprint factor drives bob/FOV so toggling sprint eases in/out
    this._sprintAmt = damp(this._sprintAmt, this.sprinting ? 1 : 0, 10, dt);

    let targetVX = 0, targetVZ = 0, strafeSign = 0;
    if (hasInput) {
      const inv = 1 / Math.hypot(mx, mz);
      const nmx = mx * inv, nmz = mz * inv;
      const f = this.forwardVec();
      const rx = -f.z, rz = f.x; // strafe right
      let speed = CFG.player.walk + (this.boostTimer > 0 ? CFG.items.vitaminsBoost : 0);
      if (crouched) speed *= CFG.player.crouchMult;
      else if (this.sprinting) speed *= SPRINT_MULT;
      targetVX = (f.x * nmz + rx * nmx) * speed;
      targetVZ = (f.z * nmz + rz * nmx) * speed;
      strafeSign = nmx;
    }
    this._velX = damp(this._velX, targetVX, 16, dt);
    this._velZ = damp(this._velZ, targetVZ, 16, dt);

    let moved = 0;
    if (Math.hypot(this._velX, this._velZ) > 0.001) {
      const oldX = this.pos.x, oldZ = this.pos.z;
      const res = resolveCircle(
        this.pos.x + this._velX * dt, this.pos.z + this._velZ * dt,
        CFG.player.radius, 0.3, 4.6, colliders,
      );
      this.pos.x = res.x;
      this.pos.z = res.z;
      moved = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);

      // footsteps — cadence is distance-based, so faster movement already
      // fires them more often; sprinting shortens the stride further so it
      // audibly reads as running rather than just brisk walking.
      const stepLen = CFG.player.stepLen * (this.sprinting ? STEP_SPRINT_SCALE : 1);
      this._stepAcc += moved;
      if (this._stepAcc >= stepLen) {
        this._stepAcc = 0;
        Sfx.step(crouched); // wish: pass a surface hint once audio.js supports it
        game?.onFootstep?.(crouched);
      }
    }

    this.isCrouched = crouched;
    this.speedFrac = damp(this.speedFrac, moved > 0.001 ? 1 : 0, 8, dt);
    // head-bob gets faster and a touch taller as sprint ramps up
    this._bobPhase += moved * (BOB_FREQ_WALK + BOB_FREQ_SPRINT_ADD * this._sprintAmt);
    this.bob = Math.sin(this._bobPhase) * (BOB_AMP_WALK + BOB_AMP_SPRINT_ADD * this._sprintAmt) * this.speedFrac;

    // subtle lean into strafe direction, FOV widens with speed + a sprint punch
    this.lean = damp(this.lean, hasInput ? -strafeSign * 0.035 : 0, 8, dt);
    const maxSpeed = (CFG.player.walk + CFG.items.vitaminsBoost) * SPRINT_MULT;
    const curSpeed = Math.hypot(this._velX, this._velZ);
    const fovTarget = (curSpeed > 0.1 ? (curSpeed / maxSpeed) * 5 : 0) + this._sprintAmt * SPRINT_FOV_KICK;
    this.fovKick = damp(this.fovKick, fovTarget, 6, dt);

    return moved;
  }

  applyCamera(camera, shakeAmp) {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw + (Math.random() - 0.5) * shakeAmp * 0.06;
    camera.rotation.x = this.pitch + (Math.random() - 0.5) * shakeAmp * 0.06;
    camera.rotation.z = this.lean + (Math.random() - 0.5) * shakeAmp * 0.03;
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
