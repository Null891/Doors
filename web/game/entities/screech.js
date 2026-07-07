// screech.js — hunts players lingering in dark rooms. Spawns just behind
// the player with a "psst"; center it in view within the window or it
// bites. Hiding at any point cancels the attempt.

import * as THREE from '../../vendor/three.module.min.js';
import { CFG } from '../config.js';
import { rand, chance } from '../utils.js';
import { Sfx } from '../audio.js';
import { sceneFromCtx } from './sceneUtil.js';

export class Screech {
  constructor() {
    this._active = false;
    this._roomTimer = 0;
    this._cooldown = 0;
    this._looked = false;
    this.mesh = null;
  }

  update(dt, ctx) {
    this._cooldown = Math.max(0, this._cooldown - dt);
    if (this._active) { this._tickAttack(dt, ctx); return; }

    const player = ctx.player;
    if (player.hiddenIn || player.dead) { this._roomTimer = 0; return; }
    const room = ctx.world.getRoomAt(player.pos.x, player.pos.y, player.pos.z);
    const eligible = room && room.dark && !room.isShop && !room.isElevator && !room.isLobby;
    if (!eligible) { this._roomTimer = 0; return; }

    this._roomTimer += dt;
    if (this._roomTimer >= CFG.screech.rollEvery) {
      this._roomTimer = 0;
      if (this._cooldown <= 0 && chance(CFG.screech.chance)) this._trigger(ctx);
    }
  }

  _trigger(ctx) {
    const scene = sceneFromCtx(ctx);
    if (!scene) return;
    this._active = true;
    this._looked = false;
    this._cooldown = CFG.screech.cooldown;
    this._timer = CFG.screech.window;

    const player = ctx.player;
    const f = player.forwardVec();
    const rightX = -f.z, rightZ = f.x;
    const lateral = rand(-3, 3);
    this._pos = {
      x: player.pos.x - f.x * 6 + rightX * lateral,
      y: 3.2,
      z: player.pos.z - f.z * 6 + rightZ * lateral,
    };

    if (!this.mesh) this._buildMesh();
    this.mesh.position.set(this._pos.x, this._pos.y, this._pos.z);
    if (!this.mesh.parent) scene.add(this.mesh);
    this.mesh.visible = true;
    Sfx.psst();
    ctx.game.caption('...');
  }

  _buildMesh() {
    const geo = new THREE.SphereGeometry(1.1, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  _tickAttack(dt, ctx) {
    const player = ctx.player;
    this._timer -= dt;

    if (!this._looked) {
      const dx = this._pos.x - player.pos.x;
      const dy = this._pos.y - player.eyeY;
      const dz = this._pos.z - player.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0.01 && d < 40) {
        const look = player.lookVec3();
        const dot = (look.x * dx + look.y * dy + look.z * dz) / d;
        if (dot > CFG.screech.lookDot) this._looked = true;
      }
    }

    if (this._looked) {
      Sfx.screechScream();
      ctx.game.shake(1);
      this._end();
      return;
    }

    if (this._timer <= 0) {
      if (player.hiddenIn || player.dead) { this._end(); return; }
      player.damage(CFG.screech.damage);
      Sfx.bite();
      ctx.hud.scare('screech');
      ctx.game.shake(1.4);
      if (player.health <= 0) ctx.game.killPlayer('Screech');
      this._end();
    }
  }

  _end() {
    this._active = false;
    if (this.mesh) this.mesh.visible = false;
  }

  reset() {
    this._active = false;
    this._roomTimer = 0;
    this._cooldown = 0;
    if (this.mesh) this.mesh.visible = false;
  }
}
