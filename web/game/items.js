// items.js — inventory, economy (gold/knobs), the hotbar-backed carried items
// (Flashlight / Vitamins / Crucifix) plus the passive Lockpick/key counters,
// and the shop/lobby purchase pedestals.
//
// Persistence is localStorage-only (static Vercel deploy, no backend): knobs
// and the deepest-door stat survive across runs; everything else (gold, keys,
// carried items, flashlight charge) is run-scoped and wiped by resetRun().

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { toWorld, rightOf } from './utils.js';
import { Mats } from './textures.js';
import { Sfx } from './audio.js';

// localStorage keys (namespaced)
const LS_KNOBS = 'hundredDoors.knobs';
const LS_BEST = 'hundredDoors.bestDoor';

// per-item presentation. CFG uses lowercase keys; giveItem/entity code use
// capitalized names — this table bridges both.
const ITEM_META = {
  flashlight: { name: 'Flashlight', icon: '🔦' },
  lockpick:   { name: 'Lockpick',   icon: '🪛' },
  vitamins:   { name: 'Vitamins',   icon: '💊' },
  crucifix:   { name: 'Crucifix',   icon: '✝️' },
  bandage:    { name: 'Bandage',    icon: '🩹' },
  battery:    { name: 'Battery',    icon: '🔋' },
  candle:     { name: 'Candle',     icon: '🕯️' },
  revive:     { name: 'Starlight',  icon: '🌟' },
};
const ICON = {
  Flashlight: '🔦',
  Vitamins: '💊',
  Crucifix: '✝️',
  Bandage: '🩹',
  Battery: '🔋',
  Candle: '🕯️',
  Starlight: '🌟',
};

// The candle's small warm halo — dim next to the flashlight beam, but it
// never runs out, and any lit light source discourages Screech.
const CANDLE_INTENSITY = 85;

// Physically-correct light falloff needs candela-scale intensity, not the
// old ~1-3 convention (see rooms.js's LAMP_BASE_INT for the same fix).
const FLASH_ON_INTENSITY = 320;

// The real game's inventory holds 6 items.
const HOTBAR_SLOTS = 6;

function loadInt(key, def) {
  const raw = localStorage.getItem(key);
  if (raw == null) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

export class Inventory {
  constructor(hud, sfx, player) {
    this.hud = hud;
    this.sfx = sfx || Sfx;
    this.player = player;

    // run-scoped
    this.gold = 0;
    this.keys = new Set();       // door numbers we hold keys for
    this.lockpicks = 0;          // charge counter, NOT a hotbar item
    this.slots = new Array(HOTBAR_SLOTS).fill(null);
    this.selected = 0;
    this.flashlightOn = false;
    this.flashlightBattery = 0;  // seconds remaining; 0 also means "none owned"
    this.candleLit = false;

    // persistent
    this.knobs = loadInt(LS_KNOBS, 0);
    this.bestDoor = loadInt(LS_BEST, 0);

    // lazily created lights (main.js parents both to the camera)
    this._flashlightLight = null;
    this._candleLight = null;
    this._flickerPhase = 0;
  }

  // ---- persistence ------------------------------------------------
  saveKnobs() { localStorage.setItem(LS_KNOBS, String(this.knobs)); }
  saveBestDoor() { localStorage.setItem(LS_BEST, String(this.bestDoor)); }

  addKnobs(n) { this.knobs += n; this.saveKnobs(); }

  spendKnobs(n) {
    if (this.knobs < n) return false;
    this.knobs -= n;
    this.saveKnobs();
    return true;
  }

  recordDoor(n) {
    if (n > this.bestDoor) {
      this.bestDoor = n;
      this.saveBestDoor();
    }
  }

  // ---- portable save code (copy/paste progress between browsers) -----
  // Format: "DOORS-XXXX-<base64>" — XXXX is a checksum over the base64
  // payload, catching typos/truncation on import without needing a server.
  _checksum(b64) {
    let sum = 0;
    for (let i = 0; i < b64.length; i++) sum = (sum + b64.charCodeAt(i) * (i + 1)) % 999331;
    return sum.toString(36).toUpperCase().padStart(4, '0');
  }

  exportSaveCode() {
    const json = JSON.stringify({ v: 1, k: this.knobs, d: this.bestDoor });
    const b64 = btoa(json);
    return `DOORS-${this._checksum(b64)}-${b64}`;
  }

  // Returns { ok: true } or { ok: false, error }. On success, knobs/bestDoor
  // are updated and persisted immediately.
  importSaveCode(code) {
    const trimmed = (code || '').trim();
    const m = trimmed.match(/^DOORS-([0-9A-Z]{4})-(.+)$/);
    if (!m) return { ok: false, error: 'That doesn\'t look like a save code.' };
    const [, checksum, b64] = m;
    if (this._checksum(b64) !== checksum) {
      return { ok: false, error: 'Checksum mismatch — check for typos or a cut-off paste.' };
    }
    let payload;
    try {
      payload = JSON.parse(atob(b64));
    } catch (e) {
      return { ok: false, error: 'Could not read that code.' };
    }
    if (typeof payload.k !== 'number' || typeof payload.d !== 'number') {
      return { ok: false, error: 'Corrupted code.' };
    }
    this.knobs = Math.max(0, Math.floor(payload.k));
    this.bestDoor = Math.max(0, Math.floor(payload.d));
    this.saveKnobs();
    this.saveBestDoor();
    return { ok: true };
  }

  // ---- gold (in-memory, run-scoped) -------------------------------
  addGold(n) { this.gold += n; }

  spendGold(n) {
    if (this.gold < n) return false;
    this.gold -= n;
    return true;
  }

  // hands over all carried gold (main.js converts to knobs via
  // CFG.economy.goldPerKnob); we only surrender the raw amount.
  takeAllGold() {
    const g = this.gold;
    this.gold = 0;
    return g;
  }

  // ---- keys / lockpicks -------------------------------------------
  addKey(doorNumber) { this.keys.add(doorNumber); }

  useKey(doorNumber) {
    if (!this.keys.has(doorNumber)) return false;
    this.keys.delete(doorNumber);
    return true;
  }

  addLockpick(n = 1) { this.lockpicks += n; }

  useLockpick() {
    if (this.lockpicks <= 0) return false;
    this.lockpicks--;
    return true;
  }

  // ---- hotbar item helpers ----------------------------------------
  _findSlot(name) {
    return this.slots.findIndex((s) => s && s.name === name);
  }
  _firstEmpty() {
    return this.slots.findIndex((s) => s === null);
  }

  // name: 'Flashlight' | 'Vitamins' | 'Crucifix' | 'Lockpick' | 'Bandage' | 'Battery'
  giveItem(name) {
    // Lockpick is a charge counter, never a hotbar slot.
    if (name === 'Lockpick') { this.addLockpick(1); return; }

    // Flashlight: a single carried tool — topping up battery rather than
    // stacking. Picking one up (re)fills it to full.
    if (name === 'Flashlight') {
      const i = this._findSlot('Flashlight');
      this.flashlightBattery = CFG.items.flashlightBattery;
      if (i >= 0) {
        this.slots[i].meter = 1;
        return;
      }
      const empty = this._firstEmpty();
      if (empty < 0) { this.hud.toast('Hotbar full.', '#c33'); return; }
      this.slots[empty] = { name, icon: ICON.Flashlight, count: 1, meter: 1 };
      return;
    }

    // Candle: a single carried toggle light — no duplicates, no battery.
    if (name === 'Candle') {
      if (this._findSlot('Candle') >= 0) return;
      const empty = this._firstEmpty();
      if (empty < 0) { this.hud.toast('Hotbar full.', '#c33'); return; }
      this.slots[empty] = { name, icon: ICON.Candle, count: 1, meter: null };
      return;
    }

    // Crucifix / Starlight: single carried, single-use — no duplicates.
    if (name === 'Crucifix' || name === 'Starlight') {
      if (this._findSlot(name) >= 0) return; // already carrying one
      const empty = this._firstEmpty();
      if (empty < 0) { this.hud.toast('Hotbar full.', '#c33'); return; }
      this.slots[empty] = { name, icon: ICON[name], count: 1, meter: null };
      return;
    }

    // Vitamins / Bandage / Battery: stackable consumables — count increments
    // if already held, used later via useSelected().
    if (name === 'Vitamins' || name === 'Bandage' || name === 'Battery') {
      const i = this._findSlot(name);
      if (i >= 0) { this.slots[i].count++; return; }
      const empty = this._firstEmpty();
      if (empty < 0) { this.hud.toast('Hotbar full.', '#c33'); return; }
      this.slots[empty] = { name, icon: ICON[name], count: 1, meter: null };
      return;
    }
  }

  // ---- selection & use --------------------------------------------
  selectSlot(i) {
    if (i >= 0 && i < HOTBAR_SLOTS) this.selected = i;
  }

  // relative slot movement for scroll-wheel switching (wraps around)
  cycleSlot(delta) {
    this.selected = (this.selected + delta + HOTBAR_SLOTS) % HOTBAR_SLOTS;
  }

  get selectedItem() {
    return this.slots[this.selected] || null;
  }

  useSelected() {
    const item = this.selectedItem;
    if (!item) return;

    if (item.name === 'Flashlight') {
      if (this.flashlightBattery <= 0) {
        this.hud.toast('The flashlight is dead.', '#c33');
        this.sfx.error();
        return;
      }
      this.flashlightOn = !this.flashlightOn;
      this._applyFlashlight();
      this.sfx.lightSwitch();
      return;
    }

    if (item.name === 'Candle') {
      this.candleLit = !this.candleLit;
      this._applyCandle();
      this.sfx.lightSwitch();
      return;
    }

    if (item.name === 'Vitamins') {
      this.player.boostTimer = CFG.items.vitaminsTime;
      // consume one
      item.count--;
      if (item.count <= 0) this.slots[this.selected] = null;
      this.sfx.purchase(); // stand-in "gulp" cue
      this.hud.toast('You feel faster.', '#7ed07e');
      return;
    }

    if (item.name === 'Crucifix') {
      // passive: entity code checks hasCrucifix()/consumeCrucifix() itself.
      this.hud.toast('Hold it out when something comes…', '#d4af37');
      return;
    }

    if (item.name === 'Starlight') {
      // passive: main.js's killPlayer checks consumeRevive() itself.
      this.hud.toast('It will bring you back. Once.', '#e8cf7a');
      return;
    }

    if (item.name === 'Bandage') {
      if (this.player.health >= CFG.player.health) {
        this.hud.toast('Already at full health.', '#c33');
        return;
      }
      this.player.heal(CFG.items.bandageHeal);
      item.count--;
      if (item.count <= 0) this.slots[this.selected] = null;
      this.sfx.heal();
      this.hud.toast('+' + CFG.items.bandageHeal + ' health', '#7ed07e');
      return;
    }

    if (item.name === 'Battery') {
      const fi = this._findSlot('Flashlight');
      if (fi < 0) {
        this.hud.toast("You don't have a flashlight to charge.", '#c33');
        return;
      }
      const restore = CFG.items.batteryRestore * CFG.items.flashlightBattery;
      this.flashlightBattery = Math.min(CFG.items.flashlightBattery, this.flashlightBattery + restore);
      item.count--;
      if (item.count <= 0) this.slots[this.selected] = null;
      this.sfx.purchase();
      this.hud.toast('Flashlight recharged.', '#7ed07e');
      return;
    }
  }

  // ---- per-frame tick ---------------------------------------------
  update(dt) {
    if (this.flashlightOn) {
      this.flashlightBattery = Math.max(0, this.flashlightBattery - dt);
      if (this.flashlightBattery <= 0) {
        this.flashlightOn = false;
      }
    }
    // keep the flashlight slot's meter (and the spotlight) in sync every frame
    const fi = this._findSlot('Flashlight');
    if (fi >= 0) {
      this.slots[fi].meter = this.flashlightBattery / CFG.items.flashlightBattery;
    }
    this._applyFlashlight(dt);
    this._applyCandle();

    this.renderHotbar();
  }

  // ---- crucifix (called by entity code via ctx.inventory) ----------
  hasCrucifix() {
    return this._findSlot('Crucifix') >= 0;
  }

  consumeCrucifix() {
    const i = this._findSlot('Crucifix');
    if (i >= 0) this.slots[i] = null;
  }

  // ---- Starlight revive (called by main.js's killPlayer) -----------
  consumeRevive() {
    const i = this._findSlot('Starlight');
    if (i < 0) return false;
    this.slots[i] = null;
    return true;
  }

  // true if the player is carrying any *lit* light — Screech checks this
  hasLitLight() {
    return (this.flashlightOn && this.flashlightBattery > 0) || this.candleLit;
  }

  // ---- candle glow --------------------------------------------------
  getCandleLight() {
    if (!this._candleLight) {
      // small warm omnidirectional halo (color, intensity, distance, decay)
      this._candleLight = new THREE.PointLight(0xffc07a, 0, 15, 1.7);
    }
    return this._candleLight;
  }

  _applyCandle() {
    if (!this._candleLight) return;
    // soft flame waver whenever lit
    const waver = this.candleLit ? 1 + Math.sin(performance.now() / 90) * 0.12 : 0;
    this._candleLight.intensity = CANDLE_INTENSITY * waver;
    this._candleLight.visible = this.candleLit;
  }

  // ---- flashlight spotlight ---------------------------------------
  getFlashlightLight() {
    if (!this._flashlightLight) {
      // (color, intensity, distance, angle, penumbra, decay)
      this._flashlightLight = new THREE.SpotLight(
        0xfff2d0, 0, 42, Math.PI / 7, 0.4, 1.2,
      );
    }
    return this._flashlightLight;
  }

  // Below ~15% charge the beam flickers as a warning, same tell the real
  // game uses before a flashlight dies outright — a hard on/off cutoff at
  // zero gave no advance notice.
  _applyFlashlight(dt = 0) {
    if (!this._flashlightLight) return;
    const lit = this.flashlightOn && this.flashlightBattery > 0;
    if (!lit) {
      this._flashlightLight.intensity = 0;
      this._flashlightLight.visible = false;
      return;
    }
    const frac = this.flashlightBattery / CFG.items.flashlightBattery;
    let mult = 1;
    if (frac < 0.15) {
      this._flickerPhase += dt * 14;
      mult = 0.5 + 0.5 * Math.abs(Math.sin(this._flickerPhase)) * (0.5 + 0.5 * Math.random());
    }
    this._flashlightLight.intensity = FLASH_ON_INTENSITY * mult;
    this._flashlightLight.visible = true;
  }

  // ---- rendering ---------------------------------------------------
  renderHotbar() {
    this.hud.renderHotbar(this.slots, this.selected);
  }

  // ---- full run reset (new game / retry) --------------------------
  resetRun() {
    this.gold = 0;
    this.keys.clear();
    this.lockpicks = 0;
    this.slots = new Array(HOTBAR_SLOTS).fill(null);
    this.selected = 0;
    this.flashlightOn = false;
    this.flashlightBattery = 0;
    this.candleLit = false;
    this._applyFlashlight(); // turns the spotlight off if it exists
    this._applyCandle();
  }

  // ---- shop / lobby pedestals -------------------------------------
  // group: the room's THREE.Group (owns disposal of children meshes).
  // frame: the room's entry Frame. mode: 'shop' (gold) | 'lobby' (knobs).
  buildShopPedestals(group, frame, mode) {
    const isShop = mode === 'shop';
    const prices = isShop ? CFG.shopGold : CFG.lobbyKnobs;
    const currencyLabel = isShop ? 'gold' : 'knobs';

    const keys = ['flashlight', 'lockpick', 'vitamins', 'crucifix', 'bandage', 'battery', 'candle'];
    // the Starlight revive is a lobby-exclusive premium (knobs only), like
    // the real game's revives never being purchasable mid-run for gold
    if (!isShop) keys.push('revive');
    const interactables = [];

    // shared geometry across the (few) pedestals in this room
    const boxGeo = new THREE.BoxGeometry(3, 3.4, 3);
    const signGeo = new THREE.PlaneGeometry(3, 1);

    // Pedestals sit near the side walls; the player walks down the room's
    // center, so each sign's face must point INWARD (toward the path), not
    // just "forward" — a plane's texture only reads correctly from the side
    // its front normal points to. DoubleSide does NOT fix this: it paints
    // the same UVs on both faces, so the back reads mirrored, not flipped.
    const right = rightOf(frame);

    keys.forEach((key, i) => {
      const meta = ITEM_META[key];
      const displayName = meta.name;
      const price = prices[key];

      const side = (i % 2 === 0) ? 1 : -1;
      const row = Math.floor(i / 2);
      const { x, z } = toWorld(frame, side * (CFG.room.W / 2 - 4), 10 + row * 8);
      const signYaw = Math.atan2(-side * right[0], -side * right[1]);

      // pedestal box (Mats.darkWood is a shared, never-disposed material)
      const box = new THREE.Mesh(boxGeo, Mats.darkWood);
      box.position.set(x, 1.7, z);
      group.add(box);

      // floating price sign (Mats.sign allocates a fresh canvas texture+mat —
      // see disposal note in report). Single-line: item name + price.
      const signMat = Mats.sign(`${displayName} ${price}`, '#d4af37');
      signMat.side = THREE.DoubleSide;
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.set(x, 4.1, z);
      sign.rotation.y = signYaw;
      group.add(sign);

      interactables.push({
        pos: { x, y: 2.5, z },
        range: 4,
        getLabel: (_ctx) => `Buy ${displayName} (${price} ${currencyLabel})`,
        interact: (_ctx) => {
          const paid = isShop ? this.spendGold(price) : this.spendKnobs(price);
          if (!paid) {
            this.hud.toast(`Not enough ${currencyLabel}.`, '#c33');
            this.sfx.error();
            return;
          }
          this.giveItem(displayName);
          this.sfx.purchase();
          this.hud.toast(`Bought ${displayName}!`, '#7ed07e');
        },
      });
    });

    return interactables;
  }
}
