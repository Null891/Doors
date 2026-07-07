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

const DEBUG = /[?&]debug/.test(location.search);

// ---------------------------------------------------------------------
// Boot: scene / camera / renderer
// ---------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x08060a, 8, CFG.fogNormal);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
scene.add(camera); // required: lights parented to the camera (the flashlight) only illuminate if the camera itself is in the scene graph

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

scene.add(new THREE.AmbientLight(0x1c1814, 1.1));
scene.add(new THREE.HemisphereLight(0x1a1610, 0x0a0806, 0.35));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

initMaterials();
Input.init(canvas);
canvas.addEventListener('click', () => {
  if (gameState === 'playing' && !Input.locked && !hud.modalOpen) Input.requestLock();
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

let ambienceHandle = null;
let shakeAmp = 0;
function shake(amount) { shakeAmp = Math.max(shakeAmp, amount); }

let gameState = 'menu'; // 'menu' | 'playing' | 'paused' | 'dead' | 'won'
let won = false;
const closetTimers = new Map(); // closet -> { warn, force }

const ctx = { dt: 0, player, world, inventory, hud, input: Input, game: null };

// ---------------------------------------------------------------------
// Death / economy tables
// ---------------------------------------------------------------------
const CAUSE_TO_SCARE = {
  Rush: 'rush', Ambush: 'ambush', Screech: 'screech', Eyes: 'eyes',
  Figure: 'figure', Halt: 'halt', Dupe: 'dupe', Jack: 'jack', Hide: 'hide', Void: 'eyes',
};
const DEATH_TIPS = {
  Rush: 'When the lights flicker, get in a closet — fast.',
  Ambush: 'It comes back. Leave the closet, then hide again for every pass.',
  Screech: 'In dark rooms, listen for the whisper and look right at it.',
  Eyes: 'Do not look at it. Watch the floor and walk past.',
  Halt: 'When it says STOP, freeze completely — no moving, no looking.',
  Dupe: 'Track the real door number. A false door rumbles as you approach.',
  Jack: "Closets aren't always safe.",
  Figure: 'Crouch to move silently. If it finds your closet, stay dead still.',
  Hide: "Don't overstay in a closet — get out before something makes you.",
  Void: "Don't fall behind.",
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
  } else if (!player.hiddenIn) {
    enterCloset(closet);
  }
}

// ---------------------------------------------------------------------
// Death / win
// ---------------------------------------------------------------------
function killPlayer(cause) {
  if (player.dead || gameState !== 'playing') return;
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
    hud.showDeath({ killer: cause, tip: DEATH_TIPS[cause] || 'Keep moving.', knobs, door: world.getCurrentRoom().number });
  }, 900);
}

function pullLever() {
  if (won || gameState !== 'playing') return;
  won = true;
  gameState = 'won';
  Input.exitLock();
  Sfx.leverPull();
  director.onInteractionNoise({ x: player.pos.x, z: player.pos.z });
  const { knobs, gold } = endRunPayout(CFG.economy.winBonus);
  Sfx.winTune();
  hud.showWin({ knobs, gold });
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

  if (newRoom.isShop) {
    for (const it of inventory.buildShopPedestals(newRoom.group, newRoom.frame, 'shop')) newRoom.interactables.push(it);
    hud.toast("Jeff's Shop — a safe room. Spend your gold.", '#7ed07e');
  } else if (newRoom.isElevator) {
    hud.toast('The elevator. Pull the lever to escape.', '#7ec8ff');
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
  toggleHide, tryOpenDoor, collectGold, collectKey, toggleLights, pullLever,
  onLibraryBookRead: () => director.onBookRead(),
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

  Input.requestLock();
}

hud.on.play = () => {
  Sfx.init();
  Sfx.resume();
  if (!ambienceHandle) ambienceHandle = Sfx.ambience();
  startRun();
};
hud.on.retry = () => { hud.hideScreens(); startRun(); };
hud.on.quitToMenu = () => {
  gameState = 'menu';
  hud.hideScreens();
  hud.setGameplayVisible(false);
  Input.exitLock();
  hud.showMenu({ knobs: inventory.knobs, best: inventory.bestDoor });
};
hud.on.resume = () => {
  if (gameState === 'paused') { gameState = 'playing'; hud.hideScreens(); Input.requestLock(); }
};
hud.onModalClose = () => {
  if (gameState === 'playing') Input.requestLock();
};
hud.onPadClick = () => Sfx.padClick();

hud.setGameplayVisible(false);
hud.showMenu({ knobs: inventory.knobs, best: inventory.bestDoor });

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
  else if (room.isElevator) hud.objective('Pull the lever to escape');
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
    if (e.code === 'Digit6') { inventory.addGold(500); hud.toast('+500 debug gold'); }
  });
  window.__doors = {
    world, player, director, inventory, camera, scene,
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

  if (gameState === 'playing') {
    ctx.dt = dt;

    if (!hud.modalOpen) {
      if (Input.pressed('Digit1')) inventory.selectSlot(0);
      if (Input.pressed('Digit2')) inventory.selectSlot(1);
      if (Input.pressed('Digit3')) inventory.selectSlot(2);
      if (Input.pressed('Digit4')) inventory.selectSlot(3);
      if (Input.pressed('Digit5')) inventory.selectSlot(4);
      if (Input.pressed('KeyF')) inventory.useSelected();

      player.update(dt, world.getColliders(), null);

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
    scene.fog.far = damp(scene.fog.far, curRoom && curRoom.dark ? CFG.fogDark : CFG.fogNormal, 2, dt);

    hud.setGold(inventory.gold);
    hud.setKnobs(inventory.knobs);
    hud.setKeys(inventory.keys.size);
    hud.setHealth(player.health / CFG.player.health);

    shakeAmp *= Math.exp(-6 * dt);
    if (shakeAmp < 0.005) shakeAmp = 0;
    player.applyCamera(camera, shakeAmp);
  }

  Input.endFrame();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
