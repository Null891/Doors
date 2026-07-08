// rooms.js — procedural room geometry: floor/walls/ceiling, doorways with
// hinged doors, closets, lamps, key/gold pickups, shop-safe rooms, and the
// Door 50 library. Builds passive geometry + data only; policy (opening a
// door, spending gold, toggling lights) lives in main.js's `game` object —
// every interactable here just forwards to `ctx.game.*`.
//
// Coordinate convention: a Frame {x,z,dir} from utils.js is the ENTRY
// doorway's floor position. Local +x (rightOf) is the room's right wall,
// local +z (fwdOf) is "into the room". toWorld(frame,dx,dz) converts local
// offsets to world {x,z}; mesh rotation uses meshYaw() below (NOT
// yawOfDir, which is the camera-look convention — a mesh's local +Z axis
// needs the opposite sign convention from a camera's forward vector).

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { Mats } from './textures.js';
import { rand, randInt, chance, choice, damp, toWorld, fwdOf, rightOf, frameAt } from './utils.js';

const WALL_T = 1;       // wall thickness
const BACK_EXT = 1.5;   // how far floor/walls extend behind local z=0 to bridge the seam to the previous room
const GAP = 1.0;        // world.js chains next room's entry this far past this room's exit
// Physically-correct light falloff (Three.js r155+ default, decay=2) needs
// candela-scale intensity, not the old ~1-2 convention — tuned empirically.
const LAMP_BASE_INT = 480;
const OPEN_ANGLE = -1.95; // ~112°, doors swing "inward/away"
const CLOSET_OPEN_ANGLE = -2.05;

// Regular-room furniture pool (couch / side table / freestanding shelf) —
// placed in the same wall slots closets use, capped independently so rooms
// don't get overcrowded.
const MAX_FURNITURE = 2;
const FURNITURE_CHANCE = 0.32;
const FURNITURE_KINDS = ['couch', 'table', 'shelf'];

export { GAP };

function meshYaw(frame) {
  const f = fwdOf(frame);
  return Math.atan2(f[0], f[1]);
}

// Doors/props built into a SIDE wall (closets, left/right room exits) need
// a mesh rotated an extra quarter-turn from meshYaw(): the shared door-slab
// geometry always puts its WIDTH along its own local-X, and meshYaw() maps
// local-X to rightOf (correct only for END walls, whose gap width also runs
// along rightOf). Side walls' gaps run along fwdOf instead, so their door
// needs local-X mapped to fwdOf — i.e. meshYaw() rotated back by 90°.
function sideYaw(frame) {
  return meshYaw(frame) - Math.PI / 2;
}

// The player-yaw (camera-forward) angle that faces world direction (dx,dz).
// Uses player.js's forwardVec() convention {x:-sin(yaw), z:-cos(yaw)}, which
// is intentionally the opposite sign convention from meshYaw() above.
function playerYawFor(dx, dz) {
  return Math.atan2(-dx, -dz);
}

export function footprintAabb(frame, x0, x1, z0, z1, y0, y1) {
  const c1 = toWorld(frame, x0, z0);
  const c2 = toWorld(frame, x1, z1);
  return {
    x0: Math.min(c1.x, c2.x), x1: Math.max(c1.x, c2.x),
    z0: Math.min(c1.z, c2.z), z1: Math.max(c1.z, c2.z),
    y0, y1,
  };
}

function disposeMat(mat) {
  if (!mat) return;
  if (mat.map) mat.map.dispose();
  mat.dispose();
}

// Mats.* factory calls (Mats.wall(), Mats.door(), Mats.sign(), ...) each
// create a fresh material+texture that must be disposed with the room. The
// entries below are the opposite: constants shared across every room for
// the life of the game, and must NEVER be disposed or every other room
// using them breaks. Checked by reference, computed lazily (Mats is `null`
// until textures.js's initMaterials() runs, which happens after this
// module loads).
function isSharedMaterial(m) {
  return m === Mats.gold || m === Mats.brass || m === Mats.blackMatte
    || m === Mats.bulbOn || m === Mats.bulbOff || m === Mats.bulbBroken
    || m === Mats.purple || m === Mats.haltBlue || m === Mats.white
    || m === Mats.frame || m === Mats.darkWood || m === Mats.keyGold
    || m === Mats.paperMat
    || m === Mats.upholstery || m === Mats.foliage || m === Mats.foliageDark
    || m === Mats.terracotta;
}

// ---- a room under construction accumulates its own disposables ----
function makeBuilder(frame, group) {
  const geos = [];
  const mats = [];
  function box(cx, cz, sx, sz, cy, sy, material, castShadow = false) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, material);
    const p = toWorld(frame, cx, cz);
    mesh.position.set(p.x, cy, p.z);
    mesh.rotation.y = meshYaw(frame);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    geos.push(geo);
    group.add(mesh);
    return mesh;
  }
  function trackMat(m) { mats.push(m); return m; }
  return { box, trackMat, geos, mats };
}

// ---- walls -----------------------------------------------------------
// gap: { offset, width, height } | null. Wall runs along local-x at localZ.
function buildEndWall(b, localZ, xSpan, H, gap, material, colliders, frame) {
  const [x0, x1] = xSpan;
  const cz = localZ + WALL_T / 2;
  if (!gap) {
    b.box((x0 + x1) / 2, cz, x1 - x0, WALL_T, H / 2, H, material);
    colliders.push(footprintAabb(frame, x0, x1, localZ, localZ + WALL_T, 0, H));
    return;
  }
  const { offset, width, height } = gap;
  const gL = offset - width / 2, gR = offset + width / 2;
  if (gL > x0 + 0.05) {
    b.box((x0 + gL) / 2, cz, gL - x0, WALL_T, H / 2, H, material);
    colliders.push(footprintAabb(frame, x0, gL, localZ, localZ + WALL_T, 0, H));
  }
  if (x1 > gR + 0.05) {
    b.box((gR + x1) / 2, cz, x1 - gR, WALL_T, H / 2, H, material);
    colliders.push(footprintAabb(frame, gR, x1, localZ, localZ + WALL_T, 0, H));
  }
  const headerH = H - height;
  if (headerH > 0.05) {
    b.box(offset, cz, width, WALL_T, height + headerH / 2, headerH, material);
    colliders.push(footprintAabb(frame, gL, gR, localZ, localZ + WALL_T, height, H));
  }
}

// Wall runs along local-z at localX (side walls). gap uses the same shape,
// offset/width/height measured along z.
function buildSideWall(b, localX, zSpan, H, gap, material, colliders, frame, side) {
  const [z0, z1] = zSpan;
  const cx = localX + (side * WALL_T) / 2;
  if (!gap) {
    b.box(cx, (z0 + z1) / 2, WALL_T, z1 - z0, H / 2, H, material);
    colliders.push(footprintAabb(frame, localX, localX + side * WALL_T, z0, z1, 0, H));
    return;
  }
  const { offset, width, height } = gap;
  const gL = offset - width / 2, gR = offset + width / 2;
  if (gL > z0 + 0.05) {
    b.box(cx, (z0 + gL) / 2, WALL_T, gL - z0, H / 2, H, material);
    colliders.push(footprintAabb(frame, localX, localX + side * WALL_T, z0, gL, 0, H));
  }
  if (z1 > gR + 0.05) {
    b.box(cx, (gR + z1) / 2, WALL_T, z1 - gR, H / 2, H, material);
    colliders.push(footprintAabb(frame, localX, localX + side * WALL_T, gR, z1, 0, H));
  }
  const headerH = H - height;
  if (headerH > 0.05) {
    b.box(cx, offset, WALL_T, width, height + headerH / 2, headerH, material);
    colliders.push(footprintAabb(frame, localX, localX + side * WALL_T, gL, gR, height, H));
  }
}

// ---- lamps -------------------------------------------------------------
export function breakLamp(lampRec) {
  if (lampRec.broken) return;
  lampRec.broken = true;
  if (lampRec.mesh) lampRec.mesh.material = Mats.bulbBroken;
  if (lampRec.light) lampRec.light.intensity = 0;
}

export function setRoomLightsOn(room, on) {
  room.lightsOn = on;
  for (const lamp of room.lights) {
    if (lamp.broken) continue;
    lamp.mesh.material = on ? Mats.bulbOn : Mats.bulbOff;
    lamp.light.intensity = on ? LAMP_BASE_INT : 0;
  }
}

function makeLamp(b, group, frame, localX, localZ, H, dark) {
  const p = toWorld(frame, localX, localZ);
  const y = H - 0.4;
  const geo = new THREE.BoxGeometry(2.2, 0.4, 2.2);
  const mesh = new THREE.Mesh(geo, dark ? Mats.bulbOff : Mats.bulbOn);
  mesh.position.set(p.x, y, p.z);
  b.geos.push(geo);
  group.add(mesh);
  const light = new THREE.PointLight(0xffd6a0, dark ? 0 : LAMP_BASE_INT, 34, 1.4);
  light.castShadow = false;
  light.position.set(p.x, y - 0.3, p.z);
  group.add(light);
  return { mesh, light, broken: false };
}

// ---- hinged doors (shared swing-animation helpers) ----------------------
function makeDoorPivot(frame, localX, localZ, baseYawExtra = 0) {
  const p = toWorld(frame, localX, localZ);
  const pivot = new THREE.Group();
  pivot.position.set(p.x, 0, p.z);
  const baseYaw = meshYaw(frame) + baseYawExtra;
  pivot.rotation.y = baseYaw;
  return { pivot, baseYaw };
}

export function setDoorOpen(anim, open) {
  anim.target = open ? anim.openAngle : 0;
}

export function stepRoomAnimations(room, dt) {
  for (const anim of room._doorAnims) {
    anim.current = damp(anim.current, anim.target, 9, dt);
    anim.pivot.rotation.y = anim.baseYaw + anim.current;
  }
  const t = performance.now() / 1000;
  for (const spin of room._spinProps) {
    spin.mesh.rotation.y += spin.speed * dt;
    spin.mesh.position.y = spin.baseY + Math.sin(t * 1.6 + spin.phase) * 0.35;
  }
}

// ---- door (exit) -------------------------------------------------------
// isSide: true for 'left'/'right' room exits (mounted in a side wall, whose
// gap runs along fwdOf) — false for 'end' exits (gap runs along rightOf).
// The door slab/plate/padlock children below always use the SAME local
// geometry convention (width along their own local-X); only the pivot's
// position-offset axis and rotation change between the two cases.
function buildExitDoor(b, group, frame, number, locked, doorLocalX, doorLocalZ, hingeSign, room, isSide) {
  const gw = CFG.room.doorW, gh = CFG.room.doorH;
  const hingeLocalX = isSide ? doorLocalX : doorLocalX - hingeSign * gw / 2;
  const hingeLocalZ = isSide ? doorLocalZ - hingeSign * gw / 2 : doorLocalZ;
  const { pivot, baseYaw } = makeDoorPivot(frame, hingeLocalX, hingeLocalZ, isSide ? -Math.PI / 2 : 0);
  group.add(pivot);

  const doorGeo = new THREE.BoxGeometry(gw - 0.4, gh - 0.4, 0.5);
  const doorMesh = new THREE.Mesh(doorGeo, Mats.door());
  doorMesh.position.set(hingeSign * (gw - 0.4) / 2, (gh - 0.4) / 2, 0);
  pivot.add(doorMesh);
  b.geos.push(doorGeo);
  b.trackMat(doorMesh.material);

  // A plane's front face only reads correctly from the side its normal
  // points toward. Offset -Z (toward the room this door was BUILT in, where
  // an approaching player actually is) and rotate 180° so the un-rotated
  // default (+Z-facing) front face points back at them, not away.
  const plateGeo = new THREE.PlaneGeometry(1.6, 0.8);
  const plateMat = Mats.numberPlate(number);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.set(hingeSign * (gw - 0.4) / 2, gh * 0.62, -0.32);
  plate.rotation.y = Math.PI;
  pivot.add(plate);
  b.geos.push(plateGeo);
  b.trackMat(plateMat);

  let padlockMesh = null;
  if (locked) {
    const pGeo = new THREE.BoxGeometry(0.7, 0.9, 0.4);
    padlockMesh = new THREE.Mesh(pGeo, Mats.gold);
    padlockMesh.position.set(hingeSign * (gw - 1.4), gh * 0.32, -0.35);
    pivot.add(padlockMesh);
    b.geos.push(pGeo);
  }

  const anim = { pivot, baseYaw, current: 0, target: 0, openAngle: hingeSign * OPEN_ANGLE };
  room._doorAnims.push(anim);

  const collider = isSide
    ? footprintAabb(frame, doorLocalX - 0.3, doorLocalX + 0.3, doorLocalZ - gw / 2, doorLocalZ + gw / 2, 0, gh)
    : footprintAabb(frame, doorLocalX - gw / 2, doorLocalX + gw / 2, doorLocalZ - 0.3, doorLocalZ + 0.3, 0, gh);

  return { doorPivot: pivot, anim, number, locked, opened: false, collider, padlockMesh };
}

// ---- closets -------------------------------------------------------------
// Always side-mounted (localX = ±W/2). wallSide matches localX's sign;
// `inward` is the local-X direction pointing from the wall into the room —
// the closet's shell bulges that way, and its door sits at the far
// (innermost) edge of that span.
function buildCloset(b, group, frame, localX, localZ, wallSide, room) {
  const w = 4.2, d = 3.0, h = 8.6;
  const inward = -wallSide;
  const depthCenterX = localX + (inward * d) / 2;

  // Shell: standard meshYaw(frame) is correct here — depth (into/out of the
  // wall) naturally maps to rightOf/local-X, width (along the wall) to
  // fwdOf/local-Z, which is exactly what these panels need.
  b.box(localX, localZ, 0.3, w, h / 2, h, Mats.darkWood);                    // back, flush with the wall
  b.box(depthCenterX, localZ - w / 2, d, 0.3, h / 2, h, Mats.darkWood);      // side panel A
  b.box(depthCenterX, localZ + w / 2, d, 0.3, h / 2, h, Mats.darkWood);      // side panel B
  b.box(depthCenterX, localZ, d, w, h + 0.2, 0.4, Mats.darkWood);            // top

  // Door: at the opening (innermost edge). Side-mounted like a left/right
  // exit door, so it needs the same sideYaw() quarter-turn fix.
  const openingX = localX + inward * d;
  const hingeZ = localZ - w / 2;
  const { pivot, baseYaw } = makeDoorPivot(frame, openingX, hingeZ, -Math.PI / 2);
  group.add(pivot);
  const doorGeo = new THREE.BoxGeometry(w - 0.3, h - 0.4, 0.3);
  const doorMesh = new THREE.Mesh(doorGeo, Mats.door());
  doorMesh.position.set((w - 0.3) / 2, (h - 0.4) / 2, 0);
  pivot.add(doorMesh);
  b.geos.push(doorGeo);

  const anim = { pivot, baseYaw, current: 0, target: 0, openAngle: CLOSET_OPEN_ANGLE };
  room._doorAnims.push(anim);

  const hp = toWorld(frame, localX + inward * (d * 0.6), localZ);
  const face = rightOf(frame);
  return {
    group: pivot, doorPivot: pivot, anim,
    hidePos: { x: hp.x, y: 3.2, z: hp.z },
    hideYaw: playerYawFor(inward * face[0], inward * face[1]),
    occupied: false,
  };
}

// ---- furniture (regular rooms) --------------------------------------------
// Purely decorative set-pieces for non-special rooms, dropped into the same
// wall slots buildCloset() uses. Like the library desk/shelves below, these
// get NO collider — that matches this file's existing convention for
// freestanding decor (only actual walls/doors/closets are collidable).
// localX is wall-flush (±W/2), matching the slot convention closets use;
// `side` is the wall side (-1 left, 1 right) and `inward` points from the
// wall into the room, same convention as buildCloset().
function buildFurniture(b, group, frame, localX, localZ, side, kind) {
  const inward = -side;
  if (kind === 'couch') {
    const width = 5.0;
    b.box(localX + inward * 0.25, localZ, 0.5, width, 1.5, 3.0, Mats.upholstery);        // backrest
    b.box(localX + inward * 1.4, localZ, 1.8, width - 0.8, 0.65, 1.3, Mats.upholstery);  // seat cushion
    b.box(localX + inward * 1.15, localZ - width / 2 + 0.3, 2.3, 0.6, 0.9, 1.8, Mats.darkWood); // armrest
    b.box(localX + inward * 1.15, localZ + width / 2 - 0.3, 2.3, 0.6, 0.9, 1.8, Mats.darkWood); // armrest
  } else if (kind === 'table') {
    b.box(localX + inward * 1.0, localZ, 0.6, 0.6, 1.0, 2.0, Mats.darkWood);   // pedestal leg
    b.box(localX + inward * 1.0, localZ, 1.4, 1.4, 2.05, 0.15, Mats.darkWood); // tabletop
    const geo = new THREE.SphereGeometry(0.22, 8, 6);
    const mesh = new THREE.Mesh(geo, Mats.gold);
    const p = toWorld(frame, localX + inward * 1.0, localZ);
    mesh.position.set(p.x, 2.92, p.z); // small gold ornament resting on the tabletop
    b.geos.push(geo);
    group.add(mesh);
  } else { // shelf — reuses the library's bookshelf texture on a standalone carcass
    const width = 3.0;
    b.box(localX + inward * 0.6, localZ, 1.2, width, 2.5, 5.0, Mats.darkWood); // carcass
    const shelfMat = Mats.shelf(1, 2);
    b.trackMat(shelfMat);
    const faceGeo = new THREE.PlaneGeometry(width - 0.2, 4.8);
    const p = toWorld(frame, localX + inward * 1.21, localZ);
    const mesh = new THREE.Mesh(faceGeo, shelfMat);
    mesh.position.set(p.x, 2.5, p.z);
    mesh.rotation.y = meshYaw(frame) + (side === -1 ? Math.PI / 2 : -Math.PI / 2);
    b.geos.push(faceGeo);
    group.add(mesh);
  }
}

// ---- greenhouse decor (doors 90-99) ---------------------------------------
// Vine strands climbing the walls, floor planters, and vines dripping from
// the ceiling. All purely decorative (no colliders), mirroring how
// paintings/furniture work elsewhere in this file.
function addVineStrand(b, group, frame, localX, localZ, side, H) {
  const inward = -side;
  const trunkH = rand(H - 4, H - 1.5);
  b.box(localX + inward * 0.2, localZ, 0.35, 0.4, trunkH / 2, trunkH, Mats.foliage);
  const leafCount = randInt(3, 5);
  for (let i = 0; i < leafCount; i++) {
    const y = rand(1.5, trunkH - 1);
    const geo = new THREE.BoxGeometry(0.7, 0.5, 0.7);
    const mesh = new THREE.Mesh(geo, i % 2 === 0 ? Mats.foliage : Mats.foliageDark);
    const p = toWorld(frame, localX + inward * 0.6, localZ + rand(-0.6, 0.6));
    mesh.position.set(p.x, y, p.z);
    mesh.rotation.y = rand(0, Math.PI * 2);
    b.geos.push(geo);
    group.add(mesh);
  }
}

function addFloorPlanter(b, group, frame, localX, localZ, side) {
  const inward = -side;
  const cx = localX + inward * 1.3;
  b.box(cx, localZ, 1.6, 2.4, 0.9, 1.8, Mats.terracotta); // oblong planter box
  const foliageCount = randInt(3, 5);
  for (let i = 0; i < foliageCount; i++) {
    const geo = new THREE.BoxGeometry(rand(0.6, 1.1), rand(1.2, 2.2), rand(0.6, 1.1));
    const mesh = new THREE.Mesh(geo, i % 2 === 0 ? Mats.foliage : Mats.foliageDark);
    const p = toWorld(frame, cx + rand(-0.6, 0.6), localZ + rand(-0.9, 0.9));
    mesh.position.set(p.x, 1.8 + rand(0, 0.6), p.z);
    mesh.rotation.y = rand(0, Math.PI * 2);
    b.geos.push(geo);
    group.add(mesh);
  }
}

function addHangingVine(b, group, frame, localX, localZ, H) {
  const dropLen = rand(2.5, 5);
  const cy = H - dropLen / 2 - 0.3;
  b.box(localX, localZ, 0.3, 0.3, cy, dropLen, Mats.foliageDark);
}

// ---- gold / key props ----------------------------------------------------
function makeSpinner(b, group, room, frame, localX, localZ, geo, material, baseY, spinSpeed) {
  const p = toWorld(frame, localX, localZ);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(p.x, baseY, p.z);
  group.add(mesh);
  room._spinProps.push({ mesh, speed: spinSpeed, baseY, phase: rand(0, 6.28) });
  return mesh;
}

// =========================================================================
export function buildRoom(frame, opts) {
  const {
    number, length, exit, exitOffset = 0,
    locked = false, dark = false,
    isShop = false, isElevator = false, isLobby = false, isLibrary = false,
  } = opts;

  const W = CFG.room.W, H = CFG.room.H;
  // Doors 90-99 ("The Greenhouse" in the real game): always dark (already
  // true via world.js's `dark` roll), but also gets its own wall material +
  // decor pool below instead of the standard hotel dressing.
  const isGreenhouse = number >= CFG.room.greenhouseStart && number < CFG.room.finalRoom;
  const group = new THREE.Group();
  group.name = `Room_${number}`;

  const room = {
    number, group, frame, exitFrame: null, length,
    bounds: null, colliders: [], pathNodes: [],
    dark, isShop, isElevator, isLobby, isLibrary, isGreenhouse,
    lights: [], switchObj: null, closets: [],
    exitDoor: null, keyPedestal: null, goldPiles: [],
    leverGroup: null, interactables: [],
    lightsOn: !dark,
    _doorAnims: [], _spinProps: [], _disposeGeo: [], _disposeMat: [],
  };

  const b = makeBuilder(frame, group);

  // ---- floor / ceiling (extended back to bridge the seam) ----
  const floorMat = dark ? Mats.floorDark(length / 8, W / 8) : Mats.floor(length / 8, W / 8);
  const ceilMat = Mats.ceiling(length / 10, W / 10);
  b.trackMat(floorMat); b.trackMat(ceilMat);
  const fz0 = -BACK_EXT, fz1 = length + 1;
  b.box(0, (fz0 + fz1) / 2, W + 1, fz1 - fz0, -0.5, 1, floorMat);
  b.box(0, (fz0 + fz1) / 2, W + 1, fz1 - fz0, H + 0.5, 1, ceilMat);

  // The Greenhouse has no hotel carpet runner in the real game (bare/worn
  // floor with planters instead), so skip it there.
  if (!isGreenhouse) {
    const carpetMat = Mats.carpet(1.2, length / 10);
    b.trackMat(carpetMat);
    b.box(0, length / 2, Math.min(6, W - 6), length, 0.02, 0.05, carpetMat);
  }

  // ---- walls ----
  const wallMat = isLibrary ? Mats.wainscot(length / 6, H / 8)
    : isGreenhouse ? Mats.greenhouseWall(length / 6, H / 8)
    : Mats.wall(length / 6, H / 8);
  b.trackMat(wallMat);

  const sideExitZ = length - CFG.room.sideInset;
  const leftGap = exit === 'left' ? { offset: sideExitZ, width: CFG.room.doorW, height: CFG.room.doorH } : null;
  const rightGap = exit === 'right' ? { offset: sideExitZ, width: CFG.room.doorW, height: CFG.room.doorH } : null;
  const endGap = exit === 'end' ? { offset: exitOffset, width: CFG.room.doorW, height: CFG.room.doorH } : null;

  buildSideWall(b, -W / 2, [fz0, length], H, leftGap, wallMat, room.colliders, frame, -1);
  buildSideWall(b, W / 2, [fz0, length], H, rightGap, wallMat, room.colliders, frame, 1);
  buildEndWall(b, length, [-W / 2, W / 2], H, endGap, wallMat, room.colliders, frame);

  // ---- lamps ----
  const lampCount = Math.max(1, Math.floor(length / 18));
  for (let i = 0; i < lampCount; i++) {
    const z = (length * (i + 0.5)) / lampCount;
    room.lights.push(makeLamp(b, group, frame, 0, z, H, dark));
  }
  if (isShop || isLobby || isElevator) {
    room.lights.push(makeLamp(b, group, frame, -W / 4, length / 2, H, false));
    room.lights.push(makeLamp(b, group, frame, W / 4, length / 2, H, false));
  }

  // ---- switch ----
  if (!isElevator && (dark || chance(CFG.room.lightSwitchChance ?? 0.4))) {
    const p = toWorld(frame, W / 2 - 0.7, 5);
    const sGeo = new THREE.BoxGeometry(0.5, 0.9, 0.3);
    const sMesh = new THREE.Mesh(sGeo, Mats.brass);
    sMesh.position.set(p.x, 4.4, p.z);
    sMesh.rotation.y = sideYaw(frame); // mounted on the right (side) wall
    b.geos.push(sGeo);
    group.add(sMesh);
    room.switchObj = { mesh: sMesh };
  }

  // ---- exit door ----
  if (exit !== 'none') {
    let doorLocalX, doorLocalZ, hingeSign, exitFrame;
    if (exit === 'end') {
      doorLocalX = exitOffset; doorLocalZ = length; hingeSign = 1;
      const p = toWorld(frame, exitOffset, length);
      exitFrame = frameAt(p.x, p.z, frame.dir);
    } else if (exit === 'left') {
      doorLocalX = -W / 2; doorLocalZ = sideExitZ; hingeSign = 1;
      const p = toWorld(frame, -W / 2, sideExitZ);
      exitFrame = frameAt(p.x, p.z, frame.dir - 1);
    } else {
      doorLocalX = W / 2; doorLocalZ = sideExitZ; hingeSign = -1;
      const p = toWorld(frame, W / 2, sideExitZ);
      exitFrame = frameAt(p.x, p.z, frame.dir + 1);
    }
    room.exitFrame = exitFrame;
    const isSideExit = exit !== 'end';
    room.exitDoor = buildExitDoor(b, group, frame, number + 1, locked, doorLocalX, doorLocalZ, hingeSign, room, isSideExit);
    room.exitDoor.isSideExit = isSideExit;

    const doorInteractable = {
      pos: toWorld(frame, doorLocalX, doorLocalZ), range: 5.5, isExitDoor: true,
      getLabel: (ctx) => room.exitDoor.opened ? null
        : (room.exitDoor.locked ? `Locked — Door ${room.exitDoor.number}` : `Open Door ${room.exitDoor.number}`),
      interact: (ctx) => ctx.game.tryOpenDoor(room.exitDoor, room),
    };
    doorInteractable.pos.y = 4;
    room.interactables.push(doorInteractable);
  } else {
    const p = toWorld(frame, 0, length - 3);
    room.exitFrame = frameAt(p.x, p.z, frame.dir);
  }

  room.pathNodes = [
    { x: frame.x, y: 5, z: frame.z },
    { x: room.exitFrame.x, y: 5, z: room.exitFrame.z },
  ];

  // ---- closets (+ furniture in leftover slots, regular rooms only) ----
  // The Greenhouse keeps its "crudely-made closets" per room (matching the
  // real game) but never gets couch/table/shelf furniture — it has no
  // tables or containers there. Closets take priority over furniture in any
  // given slot; a slot that doesn't roll a closet may roll furniture
  // instead (regular rooms only), so the two never occupy the same spot.
  if (!isElevator && !isShop && !isLibrary) {
    const slots = [];
    for (let z = 8; z <= length - 10; z += 8) {
      if (!(exit === 'left' && Math.abs(z - sideExitZ) < 7)) slots.push({ side: -1, z });
      if (!(exit === 'right' && Math.abs(z - sideExitZ) < 7)) slots.push({ side: 1, z });
    }
    for (let i = slots.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    let placedClosets = 0;
    let placedFurniture = 0;
    const allowFurniture = !isGreenhouse;
    for (const slot of slots) {
      const localX = slot.side === -1 ? -W / 2 : W / 2;
      if (placedClosets < CFG.room.maxClosets && chance(CFG.room.closetChance)) {
        placedClosets++;
        const closet = buildCloset(b, group, frame, localX, slot.z, slot.side, room);
        room.closets.push(closet);
        room.interactables.push({
          pos: closet.hidePos, range: 4.5,
          getLabel: (ctx) => (closet.occupied && ctx.player.hiddenIn !== closet) ? null
            : (ctx.player.hiddenIn === closet ? 'Come out' : 'Hide'),
          interact: (ctx) => ctx.game.toggleHide(closet),
        });
        continue;
      }
      if (allowFurniture && placedFurniture < MAX_FURNITURE && chance(FURNITURE_CHANCE)) {
        placedFurniture++;
        buildFurniture(b, group, frame, localX, slot.z, slot.side, choice(FURNITURE_KINDS));
      }
    }
  }

  // ---- greenhouse decor (doors 90-99): vines on the walls, floor
  // planters, and vines dripping from the ceiling ----
  if (isGreenhouse) {
    const vineCount = Math.max(2, Math.floor(length / 14));
    for (let i = 0; i < vineCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = rand(6, Math.max(7, length - 6));
      if (exit === (side === -1 ? 'left' : 'right') && Math.abs(z - sideExitZ) < 6) continue;
      addVineStrand(b, group, frame, side * W / 2, z, side, H);
    }
    const planterCount = randInt(1, 3);
    for (let i = 0; i < planterCount; i++) {
      const side = choice([-1, 1]);
      const z = rand(8, Math.max(9, length - 8));
      if (exit === (side === -1 ? 'left' : 'right') && Math.abs(z - sideExitZ) < 7) continue;
      addFloorPlanter(b, group, frame, side * W / 2, z, side);
    }
    const hangCount = randInt(2, 4);
    for (let i = 0; i < hangCount; i++) {
      const x = rand(-(W / 2 - 3), W / 2 - 3);
      const z = rand(4, Math.max(5, length - 4));
      addHangingVine(b, group, frame, x, z, H);
    }
  }

  // ---- key pedestal ----
  if (locked && room.exitDoor) {
    const kx = choice([-1, 1]) * (W / 2 - 4);
    const kz = randInt(8, Math.max(9, length - 10));
    const pedGeo = new THREE.BoxGeometry(1.6, 3, 1.6);
    const p = toWorld(frame, kx, kz);
    const pedMesh = new THREE.Mesh(pedGeo, Mats.frame);
    pedMesh.position.set(p.x, 1.5, p.z);
    b.geos.push(pedGeo);
    group.add(pedMesh);

    const keyGeo = new THREE.BoxGeometry(1.1, 0.2, 0.4);
    const keyMesh = makeSpinner(b, group, room, frame, kx, kz, keyGeo, Mats.keyGold, 3.4, 1.4);
    b.geos.push(keyGeo);

    const pedestal = { mesh: keyMesh, doorNumber: number + 1, taken: false };
    room.keyPedestal = pedestal;
    room.interactables.push({
      pos: { x: p.x, y: 3.4, z: p.z }, range: 4,
      getLabel: () => pedestal.taken ? null : `Take Key (Door ${pedestal.doorNumber})`,
      interact: (ctx) => ctx.game.collectKey(pedestal, room),
    });
  }

  // ---- gold ----
  if (!isLobby && !isElevator && chance(CFG.room.goldChance)) {
    const gx = randInt(-(W / 2 - 3), W / 2 - 3);
    const gz = randInt(6, Math.max(7, length - 8));
    const amount = randInt(CFG.room.goldMin, CFG.room.goldMax);
    const goldGeo = new THREE.CylinderGeometry(0.6, 0.8, 0.6, 6);
    const goldMesh = makeSpinner(b, group, room, frame, gx, gz, goldGeo, Mats.gold, 0.6, 2.2);
    b.geos.push(goldGeo);
    const p = toWorld(frame, gx, gz);
    const pile = { mesh: goldMesh, amount, taken: false };
    room.goldPiles.push(pile);
    room.interactables.push({
      pos: { x: p.x, y: 1, z: p.z }, range: 4,
      getLabel: () => pile.taken ? null : `Collect ${pile.amount} Gold`,
      interact: (ctx) => ctx.game.collectGold(pile, room),
    });
  }

  // ---- paintings (no old hotel portraits in the overgrown Greenhouse) ----
  if (!isLibrary && !isGreenhouse) {
    for (const side of [-1, 1]) {
      if (exit === (side === -1 ? 'left' : 'right')) continue;
      if (chance(CFG.room.paintingChance ?? 0.5)) {
        const z = randInt(6, Math.max(7, length - 6));
        const pMat = Mats.painting();
        b.trackMat(pMat);
        const pGeo = new THREE.PlaneGeometry(2.2, 2.8);
        const p = toWorld(frame, side * (W / 2 - 0.55), z);
        const mesh = new THREE.Mesh(pGeo, pMat);
        mesh.position.set(p.x, 6.5, p.z);
        mesh.rotation.y = meshYaw(frame) + (side === -1 ? Math.PI / 2 : -Math.PI / 2);
        b.geos.push(pGeo);
        group.add(mesh);
      }
    }
  }

  // ---- elevator ----
  if (isElevator) {
    const backZ = length - 3;
    const backMat = Mats.metal(2, 2);
    b.trackMat(backMat);
    b.box(0, backZ + 3.5, 8, 1, 6, 12, backMat);
    const leverGroup = new THREE.Group();
    const p = toWorld(frame, 3, backZ);
    leverGroup.position.set(p.x, 0, p.z);
    const baseGeo = new THREE.BoxGeometry(0.8, 0.6, 0.8);
    const baseMat = Mats.metal(1, 1);
    b.trackMat(baseMat);
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(0, 0.3, 0);
    leverGroup.add(baseMesh);
    const stickGeo = new THREE.BoxGeometry(0.3, 2.2, 0.3);
    const stickMesh = new THREE.Mesh(stickGeo, Mats.gold);
    stickMesh.position.set(0, 1.6, 0);
    stickMesh.rotation.z = 0.3;
    leverGroup.add(stickMesh);
    b.geos.push(baseGeo, stickGeo);
    group.add(leverGroup);
    room.leverGroup = leverGroup;

    room.interactables.push({
      pos: { x: p.x, y: 2, z: p.z }, range: 5,
      getLabel: () => 'Pull Lever',
      interact: (ctx) => ctx.game.pullLever(),
    });

    // Circuit breaker puzzle: 10 switch pickups scattered around the room,
    // plus a panel prop. Neither gets a real interactable here — like the
    // library's books, `entities/electrical.js` assigns each switch a
    // number and owns the panel's actual behavior once the room exists;
    // this just builds the passive geometry + prompt anchors.
    room.electricalSwitches = [];
    const switchGeo = new THREE.BoxGeometry(0.5, 1.3, 0.35);
    for (let i = 0; i < CFG.electrical.switchCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const sx = side * (W / 2 - randInt(2, 5));
      const sz = randInt(4, length - 4);
      const sy = rand(1.5, 4.2);
      const p2 = toWorld(frame, sx, sz);
      const mesh = new THREE.Mesh(switchGeo, Mats.brass);
      mesh.position.set(p2.x, sy, p2.z);
      mesh.rotation.y = rand(0, Math.PI * 2);
      group.add(mesh);
      room.electricalSwitches.push({ mesh, promptPos: { x: p2.x, y: sy, z: p2.z }, num: null, collected: false });
    }
    b.geos.push(switchGeo);

    const panelGeo = new THREE.BoxGeometry(3.4, 2.4, 0.3);
    const panelMat = Mats.metal(1, 1);
    b.trackMat(panelMat);
    const panelP = toWorld(frame, -6, backZ);
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    panelMesh.position.set(panelP.x, 4.2, panelP.z);
    panelMesh.rotation.y = meshYaw(frame);
    b.geos.push(panelGeo);
    group.add(panelMesh);
    room.electricalPanel = { mesh: panelMesh, promptPos: { x: panelP.x, y: 4.2, z: panelP.z } };
  }

  // ---- lobby: a broken elevator marks the starting point (the whole
  // premise — "the elevator is broken, the only way out is through") ----
  if (isLobby) {
    const elevZ = -0.85;
    const frameMat = Mats.metal(1, 1);
    b.trackMat(frameMat);
    const doorMat = Mats.metal(0.6, 2.4);
    b.trackMat(doorMat);

    b.box(0, elevZ, 9, 0.6, H / 2, H, frameMat); // alcove frame, spans the back
    b.box(-2.05, elevZ + 0.2, 3.9, 0.3, 4.5, 9, doorMat); // left door leaf
    b.box(2.05, elevZ + 0.2, 3.9, 0.3, 4.5, 9, doorMat); // right door leaf
    b.box(0, elevZ + 0.2, 0.15, 0.15, 4.5, 9.2, Mats.blackMatte); // seam shadow between doors

    const signMat = Mats.sign('OUT OF ORDER', '#c33');
    b.trackMat(signMat);
    const signGeo = new THREE.PlaneGeometry(3.2, 0.9);
    const signP = toWorld(frame, 0, elevZ + 0.4);
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(signP.x, 9.6, signP.z);
    sign.rotation.y = meshYaw(frame);
    b.geos.push(signGeo);
    group.add(sign);

    const btnP = toWorld(frame, 5.2, elevZ + 0.3);
    const btnGeo = new THREE.BoxGeometry(0.6, 1.4, 0.3);
    const btnMesh = new THREE.Mesh(btnGeo, Mats.blackMatte);
    btnMesh.position.set(btnP.x, 4.6, btnP.z);
    btnMesh.rotation.y = meshYaw(frame);
    b.geos.push(btnGeo);
    group.add(btnMesh);
    const btnLightGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const btnLight = new THREE.Mesh(btnLightGeo, new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    b.trackMat(btnLight.material);
    const btnLightP = toWorld(frame, 5.2, elevZ + 0.42);
    btnLight.position.set(btnLightP.x, 4.9, btnLightP.z);
    b.geos.push(btnLightGeo);
    group.add(btnLight);

    // ---- reception desk: echoes the real game's Room 0 reception counter
    // facing the elevator bank. Offset to the left so it stays clear of the
    // direct spawn-to-exit walking line and of the left-wall closet zone
    // (closets sit flush at localX = -W/2, extending inward by ~3 units —
    // this desk's nearest edge stays a couple units clear of that).
    const deskX = -(W / 2 - 7.5);
    const deskZ = 6;
    b.box(deskX, deskZ, 5.4, 2.2, 1.3, 2.6, Mats.darkWood);  // counter body
    b.box(deskX, deskZ, 5.7, 2.5, 2.62, 0.16, Mats.brass);   // brass-trimmed countertop

    const bellGeo = new THREE.SphereGeometry(0.22, 10, 8);
    const bellMesh = new THREE.Mesh(bellGeo, Mats.gold);
    const bellP = toWorld(frame, deskX + 1.6, deskZ - 0.7);
    bellMesh.position.set(bellP.x, 2.92, bellP.z); // sits on the countertop (top surface y=2.70)
    b.geos.push(bellGeo);
    group.add(bellMesh);

    // potted plant beside the desk
    const potGeo = new THREE.CylinderGeometry(0.5, 0.4, 1.0, 8);
    const potMesh = new THREE.Mesh(potGeo, Mats.terracotta);
    const potP = toWorld(frame, deskX - 3.2, deskZ + 0.4);
    potMesh.position.set(potP.x, 0.5, potP.z);
    b.geos.push(potGeo);
    group.add(potMesh);
    const leafGeo = new THREE.SphereGeometry(0.9, 8, 6);
    const leafMesh = new THREE.Mesh(leafGeo, Mats.foliage);
    leafMesh.position.set(potP.x, 1.3, potP.z);
    leafMesh.scale.set(1, 1.3, 1);
    b.geos.push(leafGeo);
    group.add(leafMesh);
  }

  // ---- library ----
  if (isLibrary) {
    const shelfMat = Mats.shelf(length / 8, 2);
    b.trackMat(shelfMat);
    for (const side of [-1, 1]) {
      const zLen = length - 8;
      const sGeo = new THREE.PlaneGeometry(zLen, H - 3);
      const p = toWorld(frame, side * (W / 2 - 0.52), length / 2);
      const mesh = new THREE.Mesh(sGeo, shelfMat);
      mesh.position.set(p.x, (H - 3) / 2 + 1, p.z);
      mesh.rotation.y = meshYaw(frame) + (side === -1 ? Math.PI / 2 : -Math.PI / 2);
      b.geos.push(sGeo);
      group.add(mesh);
    }

    const deskGeo = new THREE.BoxGeometry(6, 2.2, 3);
    const desk = new THREE.Mesh(deskGeo, Mats.darkWood);
    const dp = toWorld(frame, 0, length / 2);
    desk.position.set(dp.x, 1.1, dp.z);
    b.geos.push(deskGeo);
    group.add(desk);

    room.libraryBooks = [];
    const bookGeo = new THREE.BoxGeometry(0.7, 1.0, 0.35);
    const bookColors = [0x5c3a2e, 0x37452f, 0x31394f, 0x59452a, 0x4c2f3f];
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 10 + Math.floor(i / 2) * ((length - 20) / 4);
      const y = rand(2.5, 6.5);
      const mat = new THREE.MeshLambertMaterial({ color: choice(bookColors) });
      b.trackMat(mat);
      const p = toWorld(frame, side * (W / 2 - 1.1), z);
      const mesh = new THREE.Mesh(bookGeo, mat);
      mesh.position.set(p.x, y, p.z);
      mesh.rotation.y = meshYaw(frame);
      group.add(mesh);
      room.libraryBooks.push({ mesh, promptPos: { x: p.x, y, z: p.z }, data: null });
    }
    b.geos.push(bookGeo);

    const paperGeo = new THREE.PlaneGeometry(1.4, 1.8);
    const paperMesh = new THREE.Mesh(paperGeo, Mats.paperMat);
    paperMesh.position.set(dp.x, 2.25, dp.z);
    paperMesh.rotation.x = -Math.PI / 2;
    b.geos.push(paperGeo);
    group.add(paperMesh);
    room.libraryPaper = { mesh: paperMesh, promptPos: { x: dp.x, y: 2.3, z: dp.z } };

    if (room.exitDoor) room.exitDoor.locked = true;
  }

  // ---- bounds ----
  room.bounds = footprintAabb(frame, -(W / 2 + 2), W / 2 + 2, -3, length + 3, -2, H + 2);

  // ---- disposal ----
  // Traversing `group` at dispose time (rather than relying on the
  // construction-time tracking above) means anything added to this room
  // LATER by other modules — Dupe's decoy door, shop/lobby pedestals — gets
  // cleaned up automatically too, with no extra registration required.
  room.dispose = function dispose() {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of list) {
          if (m && !isSharedMaterial(m)) disposeMat(m);
        }
      }
    });
    if (group.parent) group.parent.remove(group);
  };

  return room;
}
