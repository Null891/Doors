# A Hundred Doors — a DOORS-inspired horror game, playable in the browser

A complete first-person horror game built from scratch in vanilla JS + Three.js —
**zero build step, zero external dependencies at runtime, zero art assets**.
Every wall, door, closet, entity, and sound is generated procedurally at load
time. Open [`web/index.html`](web/index.html) locally or deploy `web/` to
Vercel and you have a full run from the lobby to the Door 100 elevator escape.

*(The project also contains the original Roblox/Luau version of this game in
[`src/`](src/) — see [the Roblox section](#the-original-roblox-version) below.
Both implement the same design; the web version is the actively developed one.)*

## Play it

```
cd web
npx serve .        # or: python -m http.server 8080, or any static file server
```

Open the printed URL. Click **ENTER THE HOTEL**, click once on the canvas to
lock the mouse, and go.

**Controls:** `WASD` move · mouse look · `E` interact · `C`/`Ctrl` crouch ·
`1–5` select item · `F` use selected item · `Esc` pause.

## What's in the game

| System | Details |
|---|---|
| Procedural generation | Weighted room templates (hallways, grand halls, 90° turns), 4 rooms kept live at once, overlap-safe re-rolling, Void straggler damage+teleport when a lagging room culls |
| Doors & locks | Numbered doors, ~16% locked with a key hidden in the room, lockpicks as a fallback |
| Hiding | Closets you walk into and hide inside; camp past 9s and a warning fires, past 10.6s you're forced out and hurt |
| **Rush** | Every lamp in every loaded room flickers, then a black shape sweeps the whole loaded stretch at 46 u/s, shattering lights as it enters each room, killing anyone not hidden |
| **Ambush** | Faster, spares the lights, rebounds back and forth 2–5 times — you have to keep re-hiding for every pass |
| **Screech** | Spawns behind you in dark rooms with a "psst" — center it in your view within 2.5s or take a bite |
| **Eyes** | A purple gaze parked mid-room; looking directly at it ticks damage, looking away is safe |
| **Halt** | A huge "STOP" warning — any movement or camera turn during the window is a hit |
| **Dupe** | Fake exit doors with scrambled numbers on side walls — walk into one and it bites |
| **Jack** | A rare closet jumpscare — hiding isn't always safe |
| **Figure** | Activates at the library (Door 50) and roams persistently; uncrouched movement and interactions draw it in, contact is fatal, and it can sniff you out of a closet if you move |
| **The Library (Door 50)** | Read all the books, cross-reference the paper's numeral→shape key, enter the 5-digit code on the padlock |
| Items & economy | Flashlight (battery drain), Vitamins (speed boost), Crucifix (banishes Rush/Ambush on contact), Lockpicks, gold piles, Jeff's Shop at Door 52 (safe room), gold→knobs conversion on death/escape (20:1, rounds up), knobs persisted via `localStorage` |
| Audio | 100% synthesized at runtime via Web Audio (oscillators + filtered noise) — no audio files, so sound works immediately with no asset setup |

## Deploying to Vercel

This repo is already laid out for it — `vercel.json` points `outputDirectory`
at `web/` with no build command (it's a static site). From the Vercel
dashboard: **New Project → Import this repo** → it should auto-detect the
config and deploy. Every push to `main` redeploys automatically once the
GitHub integration is connected. No environment variables or serverless
functions are needed.

## Architecture

Everything lives under [`web/game/`](web/game/), plain ES modules loaded
directly by the browser (`<script type="module">`, no bundler):

- **`config.js`** — every tuning number (room sizes, entity speeds/damage/chances, economy) in one place
- **`utils.js`** — RNG helpers and the `Frame {x,z,dir}` coordinate system every room is built in (quarter-turn rotations only, so all geometry stays axis-aligned and collision is cheap AABB math)
- **`textures.js`** — every material is a `<canvas>`-painted texture baked once at boot; `Mats.*` factories create per-room materials (must be disposed with the room), a handful of `Mats.*` constants are shared forever
- **`audio.js`** — `Sfx`, a fully synthesized sound engine (oscillators + filtered white noise, no audio files)
- **`input.js`**, **`player.js`**, **`hud.js`** — pointer-lock FPS controller, collision (cylinder-vs-AABB), and the entire UI (built as DOM, not canvas)
- **`rooms.js`** — builds one room's geometry from a `Frame` + options; every interactable it creates just forwards to `ctx.game.*` — it has no idea what a lock or gold pile *means*, only how to describe one and report the event
- **`world.js`** — the room sequence: generation, weighted templates with overlap-safe re-rolling, the three special rooms (Door 50 library / Door 52 shop / Door 100 elevator), culling
- **`entities/`** — one file per hazard (`sweeper.js` handles both Rush and Ambush), `director.js` rolls the spawn table on every door opened and ticks whichever entities are live
- **`items.js`** — inventory, hotbar, shop pedestals, the economy
- **`main.js`** — the only file that owns policy. It builds one `ctx` object (`{ player, world, inventory, hud, input, game }`) passed to every entity and interactable; `ctx.game` is where "opening a door" or "hiding in a closet" actually *means* something (lock checks, room generation, payout math). Every other module just describes the world and calls back into it.

This split is what let the room builder, the entity AI, and the inventory
system be built independently against a shared contract without needing to
know about each other's internals.

## Known limitations

- **Single-player.** The original Roblox version supports multiplayer via
  Roblox's networking; a static Vercel deploy has no realtime backend, so
  this is a deliberate scope cut, not an oversight.
- Not yet implemented: Seek (Door 200 boss), a second floor (The Mines), and
  the modifier system from the Roblox version's design doc. `entities/`
  follows a uniform `update(dt, ctx)` state-machine pattern, so adding a new
  hazard is mostly "write one more file and register it in `director.js`."
- Sound is synthesized, not sampled — it's intentionally simple (this was a
  design choice to ship with zero asset dependencies, not a placeholder).

## The original Roblox version

[`src/`](src/) contains a full DOORS-inspired game in Luau for Roblox Studio,
with the same core systems (procedural generation, Rush, hiding, keys/locks,
gold→knobs economy) built against Roblox's engine (RemoteEvents,
ModuleScripts, DataStores). See [src's own layout](src/Server) — copy each
script into Studio per the Instance/path mapping, or sync via
[`default.project.json`](default.project.json) with Rojo. It predates the web
port and isn't being actively extended, but it's a complete, playable base.
