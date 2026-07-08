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

  // A dark core studded with several small glowing eyes (with dark pupils)
  // scattered over its surface, biased toward facing outward — reads as an
  // actual cluster of eyes rather than a single flat purple ball.
  spawn(room) {
    if (this._instances.some((i) => i.room === room)) return;
    let scene = room.group;
    while (scene.parent) scene = scene.parent;

    const cx = (room.pathNodes[0].x + room.pathNodes[1].x) / 2;
    const cz = (room.pathNodes[0].z + room.pathNodes[1].z) / 2;
    const baseY = 6;

    const group = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(1.25, 12, 10);
    const core = new THREE.Mesh(coreGeo, Mats.purple);
    group.add(core);

    const eyeGeo = new THREE.SphereGeometry(0.26, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf0d6ff });
    const pupilGeo = new THREE.SphereGeometry(0.12, 6, 5);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x180024 });
    const eyeCount = 6;
    for (let i = 0; i < eyeCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 1.15); // bias toward the front hemisphere
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi) * 0.7;
      const dz = Math.sin(phi) * Math.sin(theta);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx * 1.2, dy * 1.2, dz * 1.2);
      group.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(dx * 1.32, dy * 1.32, dz * 1.32);
      group.add(pupil);
    }

    group.position.set(cx, baseY, cz);
    scene.add(group);

    const loop = Sfx.eyesLoop();

    this._instances.push({
      room, mesh: group, geos: [coreGeo, eyeGeo, pupilGeo], mats: [eyeMat, pupilMat],
      loop, baseY, phase: Math.random() * Math.PI * 2, t: 0, tickTimer: CFG.eyes.tick,
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
      inst.mesh.rotation.y += dt * 0.2; // slow scan, purely visual — gaze check is position-based

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
    for (const g of inst.geos) g.dispose();
    for (const m of inst.mats) m.dispose();
    this._instances.splice(i, 1);
  }

  despawnAll() {
    for (let i = this._instances.length - 1; i >= 0; i--) this._despawnAt(i);
  }

  // Real DOORS' Eyes "scatter when the door to the next room is opened" —
  // they don't linger for the several extra rooms world.maxLoaded culling
  // would otherwise let them survive. Called once per onDoorOpened so any
  // instance from an earlier room is cleared the moment a new door opens.
  despawnExcept(room) {
    for (let i = this._instances.length - 1; i >= 0; i--) {
      if (this._instances[i].room !== room) this._despawnAt(i);
    }
  }
}
