// figure.js — a blind, sound-hunting patrol threat that activates once the
// player reaches the library (Door 50) and then roams persistently.
//
// Deliberately simplified vs. the source game's design: no navmesh (it just
// walks straight toward a target point, which is fine — every room is a
// straight-ish corridor); the "heartbeat" hiding minigame is replaced with
// a fair, robust "stay completely still" window rather than a bespoke
// rhythm-tap widget, since there's no existing UI for the latter and this
// is much harder to get wrong.

import * as THREE from '../../vendor/three.module.min.js';
import { CFG } from '../config.js';
import { rand } from '../utils.js';
import { Sfx } from '../audio.js';
import { sceneFromCtx } from './sceneUtil.js';

const CHASE_HOLD = 3.5; // seconds a heard/interaction noise keeps Figure in chase mode

export class Figure {
  constructor() {
    this._activated = false;
    this.mesh = null;
    this._speedMult = 1;
    this._readBooks = 0;
    this._targetPos = null;
    this._chaseUntil = -Infinity;
    this._sniffing = false;
    this._sniffTimer = 0;
    this._growlCd = 0;
  }

  get active() { return this._activated; }

  activate(room, ctx) {
    if (this._activated) return;
    const scene = sceneFromCtx(ctx);
    if (!scene) return;
    this._activated = true;
    this._buildMesh(scene);
    this.mesh.position.set(room.pathNodes[0].x, 3.6, room.pathNodes[0].z);
    this._targetPos = { x: room.pathNodes[1].x, z: room.pathNodes[1].z };
    ctx.game?.caption?.('Something else is down here...');
  }

  // A tall, gaunt, faceless silhouette with long arms reaching past the
  // knees — the group's own position/rotation drives movement exactly like
  // a single mesh would, so the rest of the file doesn't need to change.
  _buildMesh(scene) {
    const group = new THREE.Group();
    this._geos = [];
    this._mats = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0705 });
    this._mats.push(mat);

    const torsoGeo = new THREE.CapsuleGeometry(0.6, 4.2, 4, 8);
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 2.8;
    group.add(torso);
    this._geos.push(torsoGeo);

    const headGeo = new THREE.SphereGeometry(0.5, 10, 8);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.set(0, 5.35, 0.1);
    group.add(head);
    this._geos.push(headGeo);

    const armGeo = new THREE.CapsuleGeometry(0.13, 3.7, 4, 6);
    this._armL = new THREE.Mesh(armGeo, mat);
    this._armR = new THREE.Mesh(armGeo, mat);
    this._armL.position.set(-0.82, 2.55, 0);
    this._armR.position.set(0.82, 2.55, 0);
    group.add(this._armL, this._armR);
    this._geos.push(armGeo);

    this.mesh = group;
    this._animPhase = rand(0, Math.PI * 2);
    scene.add(group);
  }

  // Idle sway while patrolling, a sharper forward lean while chasing — the
  // "actions" reading distinctly different at a glance, not just faster.
  _animate(dt, chasing) {
    this._animPhase += dt * (chasing ? 5.5 : 1.6);
    const swing = Math.sin(this._animPhase) * (chasing ? 0.55 : 0.22);
    if (this._armL) { this._armL.rotation.x = swing; this._armR.rotation.x = -swing; }
    this.mesh.rotation.x = chasing ? 0.12 : 0;
  }

  onInteractionNoise(pos) {
    if (!this._activated) return;
    this._targetPos = { x: pos.x, z: pos.z };
    this._chaseUntil = performance.now() / 1000 + CHASE_HOLD;
  }

  onBookRead() {
    this._readBooks++;
    this._speedMult = Math.min(3, 1 + this._readBooks * CFG.figure.speedPerBook);
  }

  // Full run reset: must actually tear down the mesh, not just drop the
  // reference — otherwise a Figure active at run-end orphans its geometry
  // and leaves a frozen ghost capsule standing in the new run's scene.
  reset() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      for (const g of this._geos || []) g.dispose();
      for (const m of this._mats || []) m.dispose();
      this.mesh = null;
    }
    this._activated = false;
    this._speedMult = 1;
    this._readBooks = 0;
    this._targetPos = null;
    this._chaseUntil = -Infinity;
    this._sniffing = false;
  }

  update(dt, ctx) {
    if (!this._activated || !this.mesh) return;
    const player = ctx.player;

    this._handlePatrol(ctx);

    if (player.hiddenIn) {
      this._handleSniff(dt, ctx);
    } else {
      if (this._sniffing) { this._sniffing = false; ctx.hud.caption(''); }
      this._handleSensing(ctx);
      this._handleContact(ctx);
    }

    this._move(dt);
    this._growlCd = Math.max(0, this._growlCd - dt);
  }

  _handlePatrol(ctx) {
    const now = performance.now() / 1000;
    if (now < this._chaseUntil) return;
    const rooms = ctx.world.getActiveRooms();
    if (rooms.length === 0) return;
    const newest = rooms[rooms.length - 1];
    this._targetPos = { x: newest.pathNodes[0].x, z: newest.pathNodes[0].z };
  }

  _handleSensing(ctx) {
    const player = ctx.player;
    const dx = player.pos.x - this.mesh.position.x;
    const dz = player.pos.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const loud = !player.isCrouched && !player.crouch && dist < CFG.figure.hearWalk;
    const close = dist < CFG.figure.senseClose;
    if (loud || close) {
      this._targetPos = { x: player.pos.x, z: player.pos.z };
      const now = performance.now() / 1000;
      this._chaseUntil = now + CHASE_HOLD;
      if (this._growlCd <= 0 && dist < CFG.figure.hearWalk * 1.3) {
        this._growlCd = 3;
        Sfx.growl(Math.max(0.2, 1 - dist / 60));
      }
    }
  }

  _handleContact(ctx) {
    const player = ctx.player;
    const dist = Math.hypot(this.mesh.position.x - player.pos.x, this.mesh.position.z - player.pos.z);
    if (dist < CFG.figure.killDist) {
      ctx.hud.scare('figure');
      ctx.game.shake(2.2);
      ctx.game.killPlayer('Figure');
    }
  }

  _handleSniff(dt, ctx) {
    const player = ctx.player;
    const dist = Math.hypot(this.mesh.position.x - player.pos.x, this.mesh.position.z - player.pos.z);
    if (dist >= CFG.figure.senseClose) {
      if (this._sniffing) { this._sniffing = false; ctx.hud.caption(''); }
      return;
    }
    if (!this._sniffing) {
      this._sniffing = true;
      this._sniffTimer = CFG.figure.sniffTime;
      this._lastYaw = player.yaw;
      this._lastPitch = player.pitch;
      ctx.hud.caption("Stay still... it's right outside.");
    }
    this._sniffTimer -= dt;

    const moved = player.speedFrac > 0.02
      || Math.abs(player.yaw - this._lastYaw) > 0.01
      || Math.abs(player.pitch - this._lastPitch) > 0.01
      || ctx.input.down('KeyW') || ctx.input.down('KeyA')
      || ctx.input.down('KeyS') || ctx.input.down('KeyD')
      || ctx.input.down('ArrowUp') || ctx.input.down('ArrowDown')
      || ctx.input.down('ArrowLeft') || ctx.input.down('ArrowRight');
    this._lastYaw = player.yaw;
    this._lastPitch = player.pitch;

    if (moved) {
      this._sniffing = false;
      ctx.hud.caption('');
      const closet = player.hiddenIn;
      ctx.game.toggleHide(closet);
      ctx.hud.scare('figure');
      ctx.game.shake(2.2);
      ctx.game.killPlayer('Figure');
      return;
    }
    if (this._sniffTimer <= 0) {
      this._sniffing = false;
      ctx.hud.caption('');
      this._targetPos = {
        x: this.mesh.position.x + rand(-20, 20),
        z: this.mesh.position.z + rand(-20, 20),
      };
      this._chaseUntil = -Infinity;
    }
  }

  _move(dt) {
    if (!this._targetPos || !this.mesh) return;
    const now = performance.now() / 1000;
    const chasing = now < this._chaseUntil;
    this._animate(dt, chasing);
    const speed = (chasing ? CFG.figure.chaseSpeed : CFG.figure.patrolSpeed) * this._speedMult;
    const dx = this._targetPos.x - this.mesh.position.x;
    const dz = this._targetPos.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return;
    const step = Math.min(speed * dt, dist);
    this.mesh.position.x += (dx / dist) * step;
    this.mesh.position.z += (dz / dist) * step;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }
}
