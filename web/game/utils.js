// utils.js — math, RNG, the "frame" coordinate system every room is built
// in, and the AABB collision helpers.
//
// A Frame is { x, z, dir } where dir is quarter-turns (0..3). dir 0 faces
// +Z, and each +1 is a 90° turn. Because every room direction is a multiple
// of 90°, ALL world geometry stays axis-aligned — walls and collision are
// pure AABBs, which keeps everything simple and fast.

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dist2d = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);

// ---- frames -----------------------------------------------------
export const FWD = [ [0, 1], [1, 0], [0, -1], [-1, 0] ]; // dir -> forward (x,z)

export function frameAt(x, z, dir) {
  return { x, z, dir: ((dir % 4) + 4) % 4 };
}
export const fwdOf = (f) => FWD[f.dir];
export const rightOf = (f) => FWD[(f.dir + 1) % 4];

// local (dx right, dz forward) -> world {x, z}
export function toWorld(f, dx, dz) {
  const r = rightOf(f), fw = fwdOf(f);
  return { x: f.x + r[0] * dx + fw[0] * dz, z: f.z + r[1] * dx + fw[1] * dz };
}

// derive a new frame at a local offset, optionally turned (quarter-turns)
export function subFrame(f, dx, dz, turn = 0) {
  const p = toWorld(f, dx, dz);
  return frameAt(p.x, p.z, f.dir + turn);
}

// camera yaw (THREE 'YXZ' order) that looks along FWD[dir]
export function yawOfDir(dir) {
  const f = FWD[dir];
  return Math.atan2(-f[0], -f[1]);
}

// ---- AABBs ------------------------------------------------------
export function aabb(cx, cy, cz, sx, sy, sz) {
  return {
    x0: cx - sx / 2, y0: cy - sy / 2, z0: cz - sz / 2,
    x1: cx + sx / 2, y1: cy + sy / 2, z1: cz + sz / 2,
  };
}

export function aabbOverlap2D(a, b, shrink = 0) {
  return a.x0 + shrink < b.x1 - shrink && a.x1 - shrink > b.x0 + shrink
    && a.z0 + shrink < b.z1 - shrink && a.z1 - shrink > b.z0 + shrink;
}

export function pointInAabb(x, y, z, b, pad = 0) {
  return x > b.x0 - pad && x < b.x1 + pad
    && y > b.y0 - pad && y < b.y1 + pad
    && z > b.z0 - pad && z < b.z1 + pad;
}

// Push a vertical-cylinder (radius r, feet y0..head y1) out of a list of
// AABBs on the XZ plane. Returns corrected {x, z}. Iterates a few times so
// corners resolve cleanly.
export function resolveCircle(x, z, r, y0, y1, colliders) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      if (y1 <= c.y0 || y0 >= c.y1) continue; // no vertical overlap
      const cx = clamp(x, c.x0, c.x1);
      const cz = clamp(z, c.z0, c.z1);
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        x += dx * push;
        z += dz * push;
      } else {
        // center is inside the box: exit along the shallowest axis
        const left = x - c.x0, right = c.x1 - x;
        const near = z - c.z0, far = c.z1 - z;
        const m = Math.min(left, right, near, far);
        if (m === left) x = c.x0 - r;
        else if (m === right) x = c.x1 + r;
        else if (m === near) z = c.z0 - r;
        else z = c.z1 + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}
