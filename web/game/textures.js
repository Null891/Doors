// textures.js — every texture in the game is painted onto <canvas> at boot:
// no image assets. Exposes material factories; anything a factory returns
// must be pushed to the owning room's disposables so GPU memory is freed
// when rooms cull.

import * as THREE from '../vendor/three.module.min.js';
import { rand, randInt, choice } from './utils.js';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function speckle(ctx, w, h, n, alpha, dark = true) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${rand(0, alpha)})`
      : `rgba(255,255,255,${rand(0, alpha)})`;
    ctx.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3));
  }
}

// ---- canvases (drawn once, shared) --------------------------------
const C = {};

function drawWoodPlanks(base, dark) {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const plank = 32;
    for (let y = 0; y < h; y += plank) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0.05, 0.22)})`;
      ctx.fillRect(0, y, w, plank);
      ctx.fillStyle = dark;
      ctx.fillRect(0, y, w, 2);
      // grain
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(0,0,0,${rand(0.08, 0.2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gy = y + rand(4, plank - 4);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + rand(-4, 4), w * 0.6, gy + rand(-4, 4), w, gy);
        ctx.stroke();
      }
      // plank seams
      const seam = rand(0, w);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(seam, y, 2, plank);
    }
    speckle(ctx, w, h, 300, 0.15);
  });
}

function drawWallpaper() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4a2f28';
    ctx.fillRect(0, 0, w, h);
    // stripes
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, 0, 16, h);
    }
    // damask-ish diamonds
    ctx.fillStyle = 'rgba(160,120,80,0.14)';
    for (let y = 16; y < h; y += 44) {
      for (let x = ((y / 44) % 2) * 22 + 8; x < w; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 5, y);
        ctx.fill();
      }
    }
    speckle(ctx, w, h, 400, 0.12);
    // grime at the bottom edge of the tile
    const g = ctx.createLinearGradient(0, h * 0.7, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function drawWainscot() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2e2018';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 8, 24, 48, h - 48);
      ctx.strokeStyle = 'rgba(190,150,110,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 11, 27, 42, h - 54);
    }
    speckle(ctx, w, h, 250, 0.18);
  });
}

function drawCeiling() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a332c';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 500, 0.18);
    // water stains
    for (let i = 0; i < 3; i++) {
      const g = ctx.createRadialGradient(rand(0, w), rand(0, h), 4, rand(0, w), rand(0, h), rand(20, 60));
      g.addColorStop(0, 'rgba(20,14,8,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

function drawCarpet() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5a1f1c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(212,175,55,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, w - 56, h - 56);
    speckle(ctx, w, h, 700, 0.2);
  });
}

function drawDoor() {
  return canvas(256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#4b3020';
    ctx.fillRect(0, 0, w, h);
    // vertical grain
    for (let x = 0; x < w; x += 8) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0.02, 0.12)})`;
      ctx.fillRect(x, 0, 4, h);
    }
    // panels
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 5;
    ctx.strokeRect(30, 26, w - 60, h * 0.36);
    ctx.strokeRect(30, h * 0.5, w - 60, h * 0.42);
    ctx.strokeStyle = 'rgba(210,170,120,0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 32, w - 72, h * 0.36 - 12);
    ctx.strokeRect(36, h * 0.5 + 6, w - 72, h * 0.42 - 12);
    speckle(ctx, w, h, 200, 0.12);
  });
}

function drawMetal() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#585d63';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = `rgba(255,255,255,${rand(0, 0.05)})`;
      ctx.fillRect(0, y, w, 1);
    }
    // rivets
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let x = 16; x < w; x += 56) {
      for (let y = 16; y < h; y += 56) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      }
    }
    speckle(ctx, w, h, 300, 0.12);
  });
}

function drawBrick() {
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3d2b24';
    ctx.fillRect(0, 0, w, h);
    const bh = 24, bw = 60;
    for (let y = 0, row = 0; y < h; y += bh, row++) {
      for (let x = -((row % 2) * bw / 2); x < w; x += bw) {
        ctx.fillStyle = `rgba(${randInt(90, 130)},${randInt(50, 70)},${randInt(38, 52)},1)`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    }
    speckle(ctx, w, h, 400, 0.25);
  });
}

function drawShelf() {
  // a bookshelf face: rows of book spines
  return canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#241811';
    ctx.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    const palette = ['#5c3a2e', '#37452f', '#31394f', '#59452a', '#4c2f3f', '#3c3c3c'];
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      ctx.fillStyle = '#1a120c';
      ctx.fillRect(0, y + rh - 6, w, 6); // shelf board
      let x = 4;
      while (x < w - 8) {
        const bw2 = randInt(8, 20);
        const bh2 = rh - randInt(10, 22);
        ctx.fillStyle = choice(palette);
        ctx.fillRect(x, y + rh - 6 - bh2, bw2, bh2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x + bw2 - 2, y + rh - 6 - bh2, 2, bh2);
        x += bw2 + randInt(0, 3);
      }
    }
    speckle(ctx, w, h, 200, 0.2);
  });
}

function drawPainting() {
  return canvas(128, 160, (ctx, w, h) => {
    // ornate frame
    ctx.fillStyle = '#6a5636';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#151210';
    ctx.fillRect(10, 10, w - 20, h - 20);
    // murky portrait silhouette
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 6, w / 2, h * 0.42, w * 0.6);
    g.addColorStop(0, `rgba(${randInt(70, 110)},${randInt(60, 80)},${randInt(40, 60)},1)`);
    g.addColorStop(1, 'rgba(10,8,8,1)');
    ctx.fillStyle = g;
    ctx.fillRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = 'rgba(8,6,6,0.9)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.44, w * 0.18, h * 0.16, 0, 0, 7); // head
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.85, w * 0.32, h * 0.3, 0, 0, 7); // shoulders
    ctx.fill();
    speckle(ctx, w, h, 120, 0.2);
  });
}

function drawPaper() {
  return canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#cdbb95';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(60,45,25,0.6)';
    for (let y = 24; y < h; y += 16) {
      ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y + rand(-2, 2)); ctx.stroke();
    }
    speckle(ctx, w, h, 80, 0.1);
  });
}

// ---- texture/material plumbing --------------------------------------

function texFrom(cnv, repX = 1, repY = 1) {
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.max(repX, 0.01), Math.max(repY, 0.01));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export let Mats = null;

export function initMaterials() {
  C.floor = drawWoodPlanks('#4a3627', '#241811');
  C.floorDark = drawWoodPlanks('#33261c', '#170f0a');
  C.wallpaper = drawWallpaper();
  C.wainscot = drawWainscot();
  C.ceiling = drawCeiling();
  C.carpet = drawCarpet();
  C.door = drawDoor();
  C.metal = drawMetal();
  C.brick = drawBrick();
  C.shelf = drawShelf();
  C.paper = drawPaper();

  const lam = (opts) => new THREE.MeshLambertMaterial(opts);

  Mats = {
    // shared, never disposed
    gold: lam({ color: 0xd4af37, emissive: 0x332200 }),
    brass: lam({ color: 0x8a713a }),
    blackMatte: lam({ color: 0x0b0b0e }),
    bulbOn: new THREE.MeshBasicMaterial({ color: 0xffe0b0 }),
    bulbOff: lam({ color: 0x555049 }),
    bulbBroken: lam({ color: 0x33302c }),
    purple: new THREE.MeshBasicMaterial({ color: 0xa44ce0 }),
    haltBlue: new THREE.MeshBasicMaterial({ color: 0x66ccff }),
    white: lam({ color: 0xcccccc }),
    frame: lam({ color: 0x241811 }),
    darkWood: lam({ color: 0x2e2018 }),
    keyGold: lam({ color: 0xe8c34a, emissive: 0x604810 }),
    paperMat: lam({ map: texFrom(C.paper) }),

    // factories: caller owns disposal (push into room.disposables)
    floor: (rx, ry) => lam({ map: texFrom(C.floor, rx, ry) }),
    floorDark: (rx, ry) => lam({ map: texFrom(C.floorDark, rx, ry) }),
    wall: (rx, ry) => lam({ map: texFrom(C.wallpaper, rx, ry) }),
    wainscot: (rx, ry) => lam({ map: texFrom(C.wainscot, rx, ry) }),
    ceiling: (rx, ry) => lam({ map: texFrom(C.ceiling, rx, ry) }),
    carpet: (rx, ry) => lam({ map: texFrom(C.carpet, rx, ry) }),
    door: () => lam({ map: texFrom(C.door) }),
    metal: (rx, ry) => lam({ map: texFrom(C.metal, rx, ry) }),
    brick: (rx, ry) => lam({ map: texFrom(C.brick, rx, ry) }),
    shelf: (rx, ry) => lam({ map: texFrom(C.shelf, rx, ry) }),
    painting: () => lam({ map: texFrom(drawPainting()) }),

    // door number plate: unique canvas per door
    numberPlate: (num) => {
      const cnv = canvas(128, 64, (ctx, w, h) => {
        ctx.fillStyle = '#171310';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#8a713a';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, w - 8, h - 8);
        ctx.fillStyle = '#d4af37';
        ctx.font = 'bold 40px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(num), w / 2, h / 2 + 2);
      });
      return new THREE.MeshBasicMaterial({ map: texFrom(cnv) });
    },

    // wall sign with arbitrary text ("THE HOTEL", "JEFF'S SHOP")
    sign: (text, color = '#d4af37') => {
      const cnv = canvas(512, 128, (ctx, w, h) => {
        ctx.fillStyle = '#14100c';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#6a5636';
        ctx.lineWidth = 6;
        ctx.strokeRect(6, 6, w - 12, h - 12);
        ctx.fillStyle = color;
        ctx.font = 'bold 64px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '10px';
        ctx.fillText(text, w / 2, h / 2 + 4);
      });
      return new THREE.MeshBasicMaterial({ map: texFrom(cnv) });
    },
  };
  return Mats;
}
