// eyes.js — a floating gaze parked mid-room. Looking directly at it ticks
// damage; looking away (or hiding) is safe. Manages multiple simultaneous
// spawns internally (one per room that rolled it).

import * as THREE from '../../vendor/three.module.min.js';
import { CFG } from '../config.js';
import { Mats } from '../textures.js';
import { Sfx } from '../audio.js';

export class EyesEntity {
  constructor() {
    this._instances = [];
  }

  spawn(room) {
    if (this._instances.some((i) => i.room === room)) return;
    let scene = room.group;
    while (scene.parent) scene = scene.parent;

    const cx = (room.pathNodes[0].x + room.pathNodes[1].x) / 2;
    const cz = (room.pathNodes[0].z + room.pathNodes[1].z) / 2;
    const baseY = 6;

    const geo = new THREE.SphereGeometry(1.6, 12, 10);
    const mesh = new THREE.Mesh(geo, Mats.purple);
    mesh.position.set(cx, baseY, cz);
    scene.add(mesh);

    const loop = Sfx.eyesLoop();

    this._instances.push({
      room, mesh, geo, loop, baseY,
      phase: Math.random() * Math.PI * 2, t: 0, tickTimer: CFG.eyes.tick,
    });
  }

  update(dt, ctx) {
    const player = ctx.player;
    const active = ctx.world.getActiveRooms();
    for (let i = this._instances.length - 1; i >= 0; i--) {
      const inst = this._instances[i];
      if (!active.includes(inst.room)) { this._despawnAt(i); continue; }

      inst.t += dt;
      inst.mesh.position.y = inst.baseY + Math.sin(inst.t * 1.4 + inst.phase) * 0.5;

      const dx = inst.mesh.position.x - player.pos.x;
      const dz = inst.mesh.position.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (inst.loop) inst.loop.setVol(Math.max(0, 1 - dist / 45) * 0.45);

      inst.tickTimer -= dt;
      if (inst.tickTimer > 0) continue;
      inst.tickTimer = CFG.eyes.tick;
      if (player.hiddenIn || player.dead || dist >= 35) continue;

      const dy = inst.mesh.position.y - player.eyeY;
      const d3 = Math.hypot(dx, dy, dz) || 1;
      const look = player.lookVec3();
      const dot = (look.x * dx + look.y * dy + look.z * dz) / d3;
      if (dot > CFG.eyes.lookDot) {
        player.damage(CFG.eyes.damage);
        ctx.game.shake(0.4);
        ctx.hud.damageFlash('rgba(140,40,220,0.5)');
        if (player.health <= 0) ctx.game.killPlayer('Eyes');
      }
    }
  }

  _despawnAt(i) {
    const inst = this._instances[i];
    if (inst.loop) { try { inst.loop.stop(); } catch (_) { /* already stopped */ } }
    if (inst.mesh.parent) inst.mesh.parent.remove(inst.mesh);
    inst.geo.dispose();
    this._instances.splice(i, 1);
  }

  despawnAll() {
    for (let i = this._instances.length - 1; i >= 0; i--) this._despawnAt(i);
  }
}
