// main.js — the game orchestrator. Owns the THREE.js scene/camera/renderer,
// wires every other module together through one shared `ctx` object, and
// implements the `game` policy API (door/hide/economy rules) that rooms.js
// and the entities only ever call back into — they describe the world and
// forward events here, this is where the rules actually live.

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { damp } from './utils.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { initMaterials } from './textures.js';
import { Hud } from './hud.js';
import { Player } from './player.js';
import { World } from './world.js';
import { Director } from './entities/director.js';
import { Inventory } from './items.js';
import { setDoorOpen, setRoomLightsOn } from './rooms.js';
import { maybeTriggerJack } from './entities/jack.js';
import { maybeTriggerTimothy } from './entities/timothy.js';

const DEBUG = /[?&]debug/.test(location.search);

// ---------------------------------------------------------------------
// Boot: scene / camera / renderer
// ---------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x08060a, 8, CFG.fogNormal);

const BASE_FOV = 70;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 500);
scene.add(camera); // required: lights parented to the camera (the flashlight) only illuminate if the camera itself is in the scene graph

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// Three.js r155+ defaults to physically-correct light falloff (decay=2,
// candela-scale intensity) — old-style intensity values like 1-2 that used
// to look fine now render as almost total darkness. These are tuned
// empirically against real screenshots, not the old convention.
// Kept low on purpose: DOORS rooms read moody and dim, lit mostly by their
// own lamps/flashlight rather than a bright global fill. (Still well above
// the near-zero values that once rendered everything black.)
scene.add(new THREE.AmbientLight(0x241f18, 2.0));
scene.add(new THREE.HemisphereLight(0x241e15, 0x080606, 0.95));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

initMaterials();
Input.init(canvas);
canvas.addEventListener('click', () => {
  if (gameState !== 'playing' || hud.modalOpen) return;
  // click re-grabs the pointer if it was released; once locked, a click is a
  // second "use the selected item" input alongside F (matching the controls hint)
  if (!Input.locked) { Input.requestLock(); return; }
  inventory.useSelected();
});

// ---------------------------------------------------------------------
// Core objects
// ---------------------------------------------------------------------
const hud = new Hud(document.getElementById('hud'));
const player = new Player();
const world = new World(scene);
const director = new Director();
const inventory = new Inventory(hud, Sfx, player);

// Flashlight: items.js owns on/off + battery, main.js owns the one-time
// scene-graph wiring (a SpotLight's `.target` must be placed and parented
// itself, or the beam points at the world origin instead of forward).
const flashLight = inventory.getFlashlightLight();
flashLight.position.set(0, 0, 0);
camera.add(flashLight);
flashLight.target.position.set(0, 0, -1);
camera.add(flashLight.target);
// candle: an omnidirectional halo held slightly low and forward, like a
// hand carrying it at chest height
const candleLight = inventory.getCandleLight();
candleLight.position.set(0.35, -0.6, -0.7);
camera.add(candleLight);

let ambienceHandle = null;
let heartbeatHandle = null;
let shakeAmp = 0;
function shake(amount) { shakeAmp = Math.max(shakeAmp, amount); }

let gameState = 'menu'; // 'menu' | 'playing' | 'paused' | 'dead' | 'won'
let won = false;
let powerRestored = false; // Door 100's circuit breaker puzzle gates the lever
const closetTimers = new Map(); // closet -> { warn, force }

// "Guiding Light" — real DOORS nudges a stuck player toward the key after
// lingering too long in a locked room. CFG.guidingLightDelay already existed
// as a tunable but nothing ever consumed it; this wires it up.
let stuckTimer = 0;
let guidingLight = null; // { group, glow, glowMat, light, pedestal, phase }
// one-shot Guiding Light narration beats, re-armed each run
let narratedSeek = false;
let narratedDark = false;
let narratedRush = false;
let reviveGraceUntil = 0; // brief invulnerability after a Starlight revive

const ctx = { dt: 0, player, world, inventory, hud, input: Input, game: null };

// ---------------------------------------------------------------------
// Death / economy tables
// ---------------------------------------------------------------------
const CAUSE_TO_SCARE = {
  Rush: 'rush', Ambush: 'ambush', Screech: 'screech', Eyes: 'eyes',
  Figure: 'figure', Halt: 'halt', Dupe: 'dupe', Jack: 'jack', Hide: 'hide', Void: 'eyes',
  Seek: 'seek', Timothy: 'timothy',
};
const DEATH_TIPS = {
  Rush: 'When the lights flicker, get in a closet — fast.',
  Ambush: 'It comes back. Leave the closet, then hide again for every pass.',
  Screech: 'In dark rooms, listen for the whisper and look right at it.',
  Eyes: 'Do not look at it. Watch the floor and walk past.',
  Halt: "Keep walking away from it. When it flashes TURN AROUND, reverse — don't stop, don't turn toward it.",
  Dupe: 'Track the real door number. A false door rumbles as you approach.',
  Jack: "Closets aren't always safe.",
  Figure: 'Crouch to move silently. If it finds your closet, stay dead still.',
  Hide: "Don't overstay in a closet — get out before something makes you.",
  Void: "Don't fall behind.",
  Seek: 'RUN. Sprint forward through every door — never stop, never double back.',
};
// Guiding Light's whispered line on the death screen — softer, in-fiction
// counterpart to the blunt mechanical tip above it.
const GUIDING_QUOTES = {
  Rush: 'You heard it coming. Next time, let the flicker warn you...',
  Ambush: 'It never leaves after one pass. Patience... then hide again.',
  Screech: "It hates being seen. So see it.",
  Eyes: 'Some things only hurt you when you look.',
  Halt: 'It only wanted you to keep moving away...',
  Dupe: 'The numbers never lie. The doors sometimes do.',
  Jack: 'Not every hiding place wants you in it.',
  Figure: "It cannot see you. It never needed to.",
  Hide: 'That space was never yours to keep.',
  Void: 'The dark closes in behind us. Stay with me.',
  Seek: 'I closed every door I could. You have to be faster.',
};

function computeKnobs(gold, bonus = 0) {
  const per = CFG.economy.goldPerKnob;
  const base = Math.floor(gold / per) + (gold % per >= per / 2 ? 1 : 0);
  const doorBonus = Math.floor(world.getCurrentRoom().number / 10) * CFG.economy.knobsPerTenDoors;
  return base + doorBonus + bonus;
}

function endRunPayout(bonus = 0) {
  const gold = inventory.takeAllGold();
  const knobs = computeKnobs(gold, bonus);
  inventory.addKnobs(knobs);
  inventory.recordDoor(world.getCurrentRoom().number);
  return { knobs, gold };
}

// ---------------------------------------------------------------------
// Hiding
// ---------------------------------------------------------------------
function clearClosetTimers(closet) {
  const t = closetTimers.get(closet);
  if (t) { clearTimeout(t.warn); clearTimeout(t.force); closetTimers.delete(closet); }
}

let rehideBlockedUntil = 0;

function exitCloset(closet, forced) {
  clearClosetTimers(closet);
  closet.occupied = false;
  player.hiddenIn = null;
  hud.bigWarning(null);
  setDoorOpen(closet.anim, true);
  Sfx.closetOut();
  setTimeout(() => { if (!closet.occupied) setDoorOpen(closet.anim, false); }, 500);

  const fwd = { x: -Math.sin(closet.hideYaw), z: -Math.cos(closet.hideYaw) };
  player.pos.x = closet.hidePos.x + fwd.x * 3;
  player.pos.z = closet.hidePos.z + fwd.z * 3;

  if (forced) {
    player.damage(CFG.hide.damage);
    hud.toast('Something forced you out!', '#c33');
    shake(1);
    rehideBlockedUntil = performance.now() / 1000 + CFG.hide.rehideCooldown;
    if (player.health <= 0) killPlayer('Hide');
  }
}

function enterCloset(closet) {
  closet.occupied = true;
  player.hiddenIn = closet;
  player.pos.x = closet.hidePos.x;
  player.pos.z = closet.hidePos.z;
  player.yaw = closet.hideYaw;
  player.pitch = 0;
  setDoorOpen(closet.anim, true);
  Sfx.closetIn();
  setTimeout(() => { if (closet.occupied) setDoorOpen(closet.anim, false); }, 500);

  const room = world.getRoomAt(closet.hidePos.x, 1, closet.hidePos.z) || world.getCurrentRoom();
  maybeTriggerJack(closet, room, ctx);
  maybeTriggerTimothy(closet, room, ctx);

  const warn = setTimeout(() => {
    if (player.hiddenIn === closet) hud.bigWarning('GET OUT');
  }, CFG.hide.maxTime * 1000);
  const force = setTimeout(() => {
    if (player.hiddenIn === closet) exitCloset(closet, true);
  }, (CFG.hide.maxTime + CFG.hide.grace) * 1000);
  closetTimers.set(closet, { warn, force });
}

function toggleHide(closet) {
  if (gameState !== 'playing') return;
  if (player.hiddenIn === closet) {
    exitCloset(closet, false);
  } else if (closet.occupied) {
    hud.toast('Occupied.', '#c33');
  } else if (performance.now() / 1000 < rehideBlockedUntil) {
    hud.toast("You can't hide again yet...", '#c33');
  } else if (!player.hiddenIn) {
    enterCloset(closet);
  }
}

// ---------------------------------------------------------------------
// Death / win
// ---------------------------------------------------------------------
function killPlayer(cause) {
  if (player.dead || gameState !== 'playing') return;
  if (performance.now() / 1000 < reviveGraceUntil) return;
  // Starlight: one bought second chance — back up at half health with a
  // short grace so the same contact can't instantly re-kill.
  if (inventory.consumeRevive()) {
    player.health = Math.max(player.health, CFG.player.health / 2);
    reviveGraceUntil = performance.now() / 1000 + 2.5;
    hud.damageFlash('rgba(255,240,180,1)');
    hud.narrate('Not yet. Get up — RUN.');
    Sfx.heal();
    shake(1.2);
    return;
  }
  if (player.hiddenIn) {
    clearClosetTimers(player.hiddenIn);
    player.hiddenIn.occupied = false;
    player.hiddenIn = null;
    hud.bigWarning(null);
  }
  player.dead = true;
  gameState = 'dead';
  Input.exitLock();
  hud.prompt(null);
  hud.scare(CAUSE_TO_SCARE[cause] || 'rush');
  Sfx.sting();
  shake(2.5);
  setTimeout(() => {
    const { knobs } = endRunPayout();
    hud.showDeath({
      killer: cause,
      tip: DEATH_TIPS[cause] || 'Keep moving.',
      quote: GUIDING_QUOTES[cause] || '',
      knobs,
      door: world.getCurrentRoom().number,
    });
  }, 900);
}

function restorePower() {
  powerRestored = true;
  hud.toast('Power restored — the elevator should work now.', '#7ed07e');
}

function spawnGuidingLight(pedestal) {
  if (guidingLight) return;
  const wp = new THREE.Vector3();
  pedestal.mesh.getWorldPosition(wp);
  const group = new THREE.Group();
  const glowGeo = new THREE.SphereGeometry(0.35, 10, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);
  const light = new THREE.PointLight(0xffdca0, 140, 16, 1.6);
  group.add(light);
  group.position.set(wp.x, wp.y + 1.6, wp.z);
  scene.add(group);
  guidingLight = { group, glow, glowMat, light, pedestal, phase: 0 };
  hud.toast('...something glimmers nearby.', '#e8c97a');
}

function despawnGuidingLight() {
  if (!guidingLight) return;
  guidingLight.group.parent?.remove(guidingLight.group);
  guidingLight.glow.geometry.dispose();
  guidingLight.glowMat.dispose();
  guidingLight = null;
}

function updateGuidingLight(dt, curRoom) {
  const pedestal = curRoom && curRoom.keyPedestal;
  if (!pedestal || pedestal.taken) {
    stuckTimer = 0;
    if (guidingLight) despawnGuidingLight();
    return;
  }
  stuckTimer += dt;
  if (guidingLight && guidingLight.pedestal !== pedestal) despawnGuidingLight();
  if (!guidingLight && stuckTimer > CFG.guidingLightDelay) spawnGuidingLight(pedestal);
  if (guidingLight) {
    if (guidingLight.pedestal.taken) { despawnGuidingLight(); return; }
    guidingLight.phase += dt * 2.4;
    const pulse = 0.65 + Math.sin(guidingLight.phase) * 0.35;
    guidingLight.light.intensity = 110 * pulse;
    guidingLight.glowMat.opacity = pulse;
  }
}

function pullLever() {
  if (won || gameState !== 'playing') return;
  if (!powerRestored) {
    hud.toast('The power is out. Restore it at the breaker panel first.', '#c33');
    Sfx.error();
    return;
  }
  won = true;
  gameState = 'won';
  Input.exitLock();
  Sfx.leverPull();
  director.onInteractionNoise({ x: player.pos.x, z: player.pos.z });
  // elevator ride beat: doors slam, the screen sinks to black under a rising
  // shake, and only then the stats screen fades in — instead of the stats
  // popping the same frame the lever moves.
  hud.caption('The elevator shudders to life...');
  setTimeout(() => Sfx.doorSlam(0.9), 600);
  hud.fadeTo(1, 1.9);
  shake(0.8);
  setTimeout(() => {
    hud.caption('');
    const { knobs, gold } = endRunPayout(CFG.economy.winBonus);
    Sfx.winTune();
    hud.showWin({ knobs, gold });
    hud.fadeTo(0, 1.0);
  }, 2100);
}

// ---------------------------------------------------------------------
// Doors / pickups / lights — the `game` policy object
// ---------------------------------------------------------------------
function unlockVisual(doorRec) {
  doorRec.locked = false;
  if (doorRec.padlockMesh) doorRec.padlockMesh.visible = false;
  Sfx.unlock();
}

function tryOpenDoor(doorRec, room) {
  if (doorRec.opened || gameState !== 'playing') return;
  if (doorRec.locked) {
    if (inventory.useKey(doorRec.number)) {
      unlockVisual(doorRec);
      hud.toast(`Unlocked Door ${doorRec.number}`, '#d4af37');
    } else if (inventory.useLockpick()) {
      unlockVisual(doorRec);
      hud.toast(`Picked the lock on Door ${doorRec.number}`, '#d4af37');
    } else {
      Sfx.doorLocked();
      hud.toast('Locked. Find the key in this room.', '#c33');
      return;
    }
  }
  doorRec.opened = true;
  setDoorOpen(doorRec.anim, true);
  Sfx.doorCreak();
  director.onInteractionNoise({ x: player.pos.x, z: player.pos.z });

  const newRoom = world.generateNext();
  director.onDoorOpened(newRoom, ctx);
  hud.setRoom(newRoom.number);
  stuckTimer = 0;
  despawnGuidingLight();

  if (newRoom.isShop) {
    for (const it of inventory.buildShopPedestals(newRoom.group, newRoom.frame, 'shop')) newRoom.interactables.push(it);
    hud.toast("Jeff's Shop — a safe room. Spend your gold.", '#7ed07e');
  } else if (newRoom.isElevator) {
    hud.toast('The elevator — but the power is out. Find the breaker switches.', '#7ec8ff');
  } else if (newRoom.isLibrary) {
    hud.toast('The Library. Read the books and the paper.', '#d4af37');
  }
}

function collectGold(pile, room) {
  if (pile.taken || gameState !== 'playing') return;
  pile.taken = true;
  pile.mesh.visible = false;
  inventory.addGold(pile.amount);
  Sfx.goldPickup();
  director.onInteractionNoise({ x: player.pos.x, z: player.pos.z });
  hud.toast(`+${pile.amount} gold`, '#d4af37');
}

function collectKey(pedestal, room) {
  if (pedestal.taken || gameState !== 'playing') return;
  pedestal.taken = true;
  pedestal.mesh.visible = false;
  if (guidingLight && guidingLight.pedestal === pedestal) despawnGuidingLight();
  inventory.addKey(pedestal.doorNumber);
  Sfx.keyPickup();
  director.onInteractionNoise({ x: player.pos.x, z: player.pos.z });
  hud.toast(`Took the key for Door ${pedestal.doorNumber}`, '#d4af37');
}

function toggleLights(room) {
  const anyWorking = room.lights.some((l) => !l.broken);
  if (!anyWorking) { hud.toast('The bulbs are shattered.', '#c33'); return; }
  setRoomLightsOn(room, !room.lightsOn);
  Sfx.lightSwitch();
  director.onInteractionNoise({ x: player.pos.x, z: player.pos.z });
}

const gameApi = {
  killPlayer, shake,
  notify: (text, color) => hud.toast(text, color),
  caption: (text) => hud.caption(text),
  scare: (kind) => hud.scare(kind),
  toggleHide, tryOpenDoor, collectGold, collectKey, toggleLights, pullLever, restorePower,
  onLibraryBookRead: () => director.onBookRead(),
  // discrete footstep noise: crouched steps are silent to the Figure;
  // sprinting carries much farther than walking.
  onFootstep: (crouched) => {
    if (!crouched) director.onFootstep(player.pos, player.sprinting);
  },
};
ctx.game = gameApi;

// ---------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------
function yawTowards(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return Math.atan2(-dx, -dz);
}

function startRun() {
  gameState = 'playing';
  won = false;
  powerRestored = false;
  rehideBlockedUntil = 0;
  stuckTimer = 0;
  despawnGuidingLight();
  for (const t of closetTimers.values()) { clearTimeout(t.warn); clearTimeout(t.force); }
  closetTimers.clear();
  inventory.resetRun();
  director.reset();

  const lobby = world.reset();
  player.reset(lobby.pathNodes[0].x, lobby.pathNodes[0].z, yawTowards(lobby.pathNodes[0], lobby.pathNodes[1]));
  for (const it of inventory.buildShopPedestals(lobby.group, lobby.frame, 'lobby')) lobby.interactables.push(it);

  hud.setRoom(0);
  hud.setGold(0);
  hud.setKnobs(inventory.knobs);
  hud.hideScreens();
  hud.setGameplayVisible(true);
  hud.bigWarning(null);
  hud.prompt(null);

  hud.fadeTo(1, 0);
  requestAnimationFrame(() => requestAnimationFrame(() => hud.fadeTo(0, 1.2)));
  narratedSeek = false;
  narratedDark = false;
  narratedRush = false;
  reviveGraceUntil = 0;
  setTimeout(() => {
    if (gameState === 'playing') hud.narrate('One hundred doors. Keep moving — I will light what I can.');
  }, 1400);

  Input.requestLock();
}

function showMenuScreen() {
  hud.showMenu({ knobs: inventory.knobs, best: inventory.bestDoor, saveCode: inventory.exportSaveCode() });
}

hud.on.play = () => {
  Sfx.init();
  Sfx.resume();
  if (!ambienceHandle) ambienceHandle = Sfx.ambience();
  if (!heartbeatHandle) heartbeatHandle = Sfx.heartbeat();
  // brief intro beat: the loading veil masks the world rebuild, then lifts.
  // hideScreens() first: the veil is pointer-events:none, so without it the
  // still-visible menu button could be double-clicked into two startRun()s.
  hud.hideScreens();
  hud.showLoading();
  setTimeout(() => {
    startRun();
    hud.hideLoading();
  }, 1100);
};
hud.on.retry = () => { hud.hideScreens(); startRun(); };
hud.on.quitToMenu = () => {
  gameState = 'menu';
  hud.hideScreens();
  hud.setGameplayVisible(false);
  Input.exitLock();
  world.reset(); // fresh lobby so the menu's live background is consistent, not wherever the run ended
  showMenuScreen();
};
hud.on.resume = () => {
  if (gameState === 'paused') { gameState = 'playing'; hud.hideScreens(); Input.requestLock(); }
};
hud.on.copyCode = async () => {
  const code = inventory.exportSaveCode();
  hud.setSaveCode(code);
  try {
    await navigator.clipboard.writeText(code);
    hud.saveCodeMessage('Copied to clipboard.', false);
  } catch (e) {
    hud.saveCodeMessage('Could not copy automatically — select the code and copy it manually.', true);
  }
};
hud.on.importCode = (code) => {
  const result = inventory.importSaveCode(code);
  if (result.ok) {
    showMenuScreen(); // showMenu() clears any prior message, so refresh first
    hud.saveCodeMessage('Progress restored!', false);
  } else {
    hud.saveCodeMessage(result.error, true);
  }
};
hud.onModalClose = () => {
  if (gameState === 'playing') Input.requestLock();
};
hud.onPadClick = () => Sfx.padClick();

// The menu shows a live, slow-drifting shot of the actual lobby behind a
// blurred veil — built from the same World the real game uses, so it's
// never out of sync with what the game actually looks like.
world.reset();
hud.setGameplayVisible(false);
showMenuScreen();

// Two-phase loop: open looking back at the broken elevator (the whole
// premise of the game), then slowly dolly forward down the hallway toward
// the first door. Both phases read the actual lobby geometry, so this never
// drifts out of sync with what the game really looks like.
let menuT = 0;
function updateMenuCamera(dt) {
  menuT += dt;
  const lobby = world.getActiveRooms()[0];
  if (!lobby) return;

  const cycle = 17;
  const t = menuT % cycle;
  camera.rotation.order = 'YXZ';
  camera.rotation.z = 0;

  if (t < 5.5) {
    const p = t / 5.5;
    camera.position.set(Math.sin(menuT * 0.1) * 1.6, 3.6, 11 - p * 2);
    camera.rotation.y = Math.sin(menuT * 0.06) * 0.14;
    camera.rotation.x = 0.16 + Math.sin(menuT * 0.05) * 0.015;
  } else {
    const p = (t - 5.5) / (cycle - 5.5);
    camera.position.set(Math.sin(menuT * 0.11) * 3.2, 4.5, 6 + p * 25);
    camera.rotation.y = Math.PI + Math.sin(menuT * 0.07) * 0.2;
    camera.rotation.x = Math.sin(menuT * 0.05) * 0.025 - 0.02;
  }
}

Input.onLockChange = (locked) => {
  if (!locked && gameState === 'playing' && !hud.modalOpen) {
    gameState = 'paused';
    hud.showPause();
  }
};

// ---------------------------------------------------------------------
// Interaction scan
// ---------------------------------------------------------------------
let currentInteractable = null;
function updateInteraction() {
  let best = null, bestDist = Infinity;
  for (const room of world.getActiveRooms()) {
    for (const it of room.interactables) {
      const dx = it.pos.x - player.pos.x;
      const dz = it.pos.z - player.pos.z;
      const dy = (it.pos.y ?? 3) - player.eyeY;
      const d = Math.hypot(dx, dy, dz);
      if (d > it.range) continue;
      const label = it.getLabel(ctx);
      if (!label) continue;
      if (d < bestDist) { bestDist = d; best = it; }
    }
  }
  currentInteractable = best;
  hud.prompt(best ? best.getLabel(ctx) : null);
}

function updateObjective(room) {
  if (!room) { hud.objective(''); return; }
  if (room.isLibrary) hud.objective('Find the 5-digit code — read every book, then the paper');
  else if (room.isShop) hud.objective("Jeff's Shop — spend Gold here, this room is safe");
  else if (room.isElevator) hud.objective(powerRestored ? 'Pull the lever to escape' : 'Find all 10 breaker switches, then use the panel');
  else hud.objective('');
}

// ---------------------------------------------------------------------
// Debug shortcuts (harmless outside normal play; doesn't touch 1-5/F/E)
// ---------------------------------------------------------------------
if (DEBUG) {
  window.addEventListener('keydown', (e) => {
    if (gameState !== 'playing') return;
    if (e.code === 'Digit9' && !director.sweeper.active) director.sweeper.trigger('Rush');
    if (e.code === 'Digit8') director.eyes.spawn(world.getCurrentRoom());
    if (e.code === 'Digit7' && !director.halt.active) director.halt.trigger();
    if (e.code === 'Digit0') { inventory.addGold(500); hud.toast('+500 debug gold'); }
  });
  window.__doors = {
    world, player, director, inventory, camera, scene, renderer,
    get state() { return gameState; },
    get interactable() { return currentInteractable; },
  };
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (gameState === 'menu') {
    world.update(dt); // keep lamp/prop animations alive behind the menu
    updateMenuCamera(dt);
  }

  if (gameState === 'playing') {
    ctx.dt = dt;

    if (!hud.modalOpen) {
      if (Input.pressed('Digit1')) inventory.selectSlot(0);
      if (Input.pressed('Digit2')) inventory.selectSlot(1);
      if (Input.pressed('Digit3')) inventory.selectSlot(2);
      if (Input.pressed('Digit4')) inventory.selectSlot(3);
      if (Input.pressed('Digit5')) inventory.selectSlot(4);
      if (Input.pressed('Digit6')) inventory.selectSlot(5);
      const wheel = Input.consumeWheel();
      if (wheel) inventory.cycleSlot(Math.sign(wheel));
      if (Input.pressed('KeyF')) inventory.useSelected();

      player.update(dt, world.getColliders(), gameApi);

      updateInteraction();
      if (Input.pressed('KeyE') && currentInteractable) {
        currentInteractable.interact(ctx);
        if (hud.modalOpen) Input.exitLock();
      }

      director.update(dt, ctx);
    } else {
      hud.prompt(null);
    }

    world.cullIfNeeded(player.pos, (culledRoom) => {
      const safe = world.getCurrentRoom();
      player.pos.x = safe.pathNodes[0].x;
      player.pos.z = safe.pathNodes[0].z;
      player.damage(CFG.room.voidDamage);
      hud.toast('The Void dragged you forward...', '#a44ce0');
      shake(1.5);
      if (player.health <= 0) killPlayer('Void');
    });

    world.update(dt);
    inventory.update(dt);

    const curRoom = world.getRoomAt(player.pos.x, player.pos.y, player.pos.z);
    updateObjective(curRoom);
    updateGuidingLight(dt, curRoom);
    if (director.seek.active && !narratedSeek) {
      narratedSeek = true;
      hud.narrate("Don't stop. Don't look back. RUN.");
    }
    if (director.sweeper.active && !narratedRush) {
      narratedRush = true;
      hud.narrate('Something is coming. Get out of its way — HIDE.');
    }
    if (curRoom && curRoom.dark && !curRoom.isLobby && !narratedDark) {
      narratedDark = true;
      hud.narrate('The lights here have given up. Tread carefully.');
    }
    const inDanger = curRoom && curRoom.dark && !curRoom.isShop && !curRoom.isElevator;
    scene.fog.far = damp(scene.fog.far, inDanger ? CFG.fogDark : CFG.fogNormal, 2, dt);
    const hunted = director.sweeper.active || director.seek.active || director.halt.active;
    ambienceHandle?.setTension?.(inDanger || hunted ? 1 : 0);
    hud.setDanger(hunted ? 1 : (inDanger ? 0.35 : 0));
    const hpFrac = player.health / CFG.player.health;
    heartbeatHandle?.setLevel(Math.max(
      hunted ? 0.85 : 0,
      inDanger ? 0.3 : 0,
      hpFrac < 0.3 ? 0.65 : 0,
    ));

    hud.setGold(inventory.gold);
    hud.setKnobs(inventory.knobs);
    hud.setKeys(inventory.keys.size);
    hud.setHealth(player.health / CFG.player.health);
    hud.setStamina(player.stamina);

    shakeAmp *= Math.exp(-6 * dt);
    if (shakeAmp < 0.005) shakeAmp = 0;
    player.applyCamera(camera, shakeAmp);

    const targetFov = BASE_FOV + player.fovKick;
    if (Math.abs(camera.fov - targetFov) > 0.02) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  }

  if (gameState !== 'playing') heartbeatHandle?.setLevel(0);

  Input.endFrame();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
