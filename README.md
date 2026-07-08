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
`1–6` select hotbar item · `F` use selected item · `Esc` pause.

Progress (knobs + deepest door reached) is saved to `localStorage` automatically,
and the menu also shows a **portable save code** — copy it to carry your progress
to another browser or machine, or paste one in to restore it. No account or
server required (see [the save-code system](#save-codes--persistence)).

## What's in the game

| System | Details |
|---|---|
| Procedural generation | Weighted room templates (hallways, grand halls, 90° turns), 4 rooms kept live at once, overlap-safe re-rolling, Void straggler damage+teleport when a lagging room culls |
| The Lobby | A broken elevator ("OUT OF ORDER" sign, riveted doors, call button) marks the start — the whole premise the menu subtitle references |
| Doors & locks | Numbered doors, ~16% locked with a key hidden in the room, lockpicks as a fallback |
| Hiding | Closets you walk into and hide inside; camp past ~4.5s and a warning fires, past ~5.5s you're forced out and hurt, and you can't hide again for ~12.5s after |
| **Rush** | Every lamp in every loaded room flickers, then a black shape sweeps the whole loaded stretch at 46 u/s, shattering lights as it enters each room, killing anyone not hidden |
| **Ambush** | Faster, warns by sound alone (no pre-charge light flicker — that tell belongs to Rush), shatters lights as it tears through, and rebounds back and forth 2–4 times — you have to keep re-hiding for every pass |
| **Screech** | Spawns behind you in dark rooms with a "psst" — center it in your view within 2.5s or take a bite |
| **Eyes** | A purple gaze parked mid-room; looking directly at it ticks damage, looking away is safe |
| **Halt** | A corridor chase, not a "freeze" test: it starts *behind* you and periodically flips to be *in front*, flagged by a brief "TURN AROUND" flash — survival is constantly walking *away* from wherever it currently is, across several rounds, as it tightens the pace near the door (matching the real entity, which punishes standing still, not moving) |
| **Dupe** | Fake exit doors with scrambled numbers on side walls — walk into one and it bites |
| **Jack** | A rare closet jumpscare — hiding isn't always safe |
| **Figure** | Activates at the library (Door 50) and roams persistently; uncrouched movement and interactions draw it in, contact is fatal, and it can sniff you out of a closet if you move |
| **Seek** | A scripted chase sequence: eyes and grasping hands erupt and you sprint a twisting corridor, dodging swiping arms and debris — reaching the door ends it, getting caught is fatal |
| **Timothy** | A tiny spider that occasionally leaps at your face as you slip into a closet — a pure startle that nicks a sliver of health (never lethal), the game's one *friendly* scare |
| **Ambient scares** | Non-lethal atmosphere beats the director sprinkles between real hazards — lights cutting out, distant knocks and whispers, a shape crossing a far doorway — to keep tension up without a kill on the line |
| **The Library (Door 50)** | Read the books (each shows a shape + digit), cross-reference the paper's Roman-numeral→shape key, enter the resulting 5-digit code on the padlock. Also where the Figure wakes up |
| **The Circuit Breaker (Door 100)** | The final room's elevator is dead: collect all 10 switch pickups scattered around the electrical room, then solve a 3-round memory sequence at the locked panel to restore power before the lever will work. Round 3 hides one "mystery" switch you must deduce (the sum of that round's other flips). Only then does the escape elevator open |
| Items & economy | Flashlight (battery drain), Vitamins (speed boost), Crucifix (single-use, auto-banishes Rush/Ambush on contact), Bandage (heal), Battery (recharge the flashlight), Candle (infinite light that deters Screech), Starlight (lobby-only one-shot revive), passive Lockpicks (fallback for locked doors), gold piles, **Jeff's Shop appears three times (Doors 22 / 52 / 78)** as safe rooms where you spend gold, El Goblino & Jeff hanging around, gold→knobs conversion on death/escape (20:1, rounds up), knobs persisted via `localStorage` |
| Audio | 100% synthesized at runtime via Web Audio — no audio files. A shared reverb bus for spatial depth, Rush/Ambush crossfade between a muffled "far" layer and a distorted "near" layer as they approach (mirroring the real game's two-recording technique), Ambush's scream uses a Shepard tone (the auditory illusion of endlessly rising pitch), jumpscares layer a sub-bass hit + distorted scream sweep + static + rumble tail, and the ambient drone gets more dissonant in dark/dangerous rooms |
| Menu | A live, slow-panning 3D shot of the actual lobby (starting on the elevator, then dollying down the hallway) behind a blurred veil, with staggered entrance animations — not a static screen |

## Save codes & persistence

There is no backend, so progress lives in the browser's `localStorage` under
`hundredDoors.knobs` and `hundredDoors.bestDoor` (your knob balance and the
deepest door you've reached). Everything else — gold, keys, carried items,
flashlight charge — is run-scoped and wiped when a run resets.

To move progress between browsers or machines without an account, the pause/main
menu shows a **portable save code** of the form `DOORS-XXXX-<base64>`: the base64
payload is a tiny JSON blob (`{v,k,d}` = version, knobs, best door) and `XXXX`
is a checksum over it, so a typo or a cut-off paste is caught on import instead
of silently corrupting your save. Copy it out, or paste one into the import box
to restore — knobs and best-door are updated and re-persisted immediately.

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
- **`textures.js`** — every material is a `<canvas>`-painted texture baked once at boot; `Mats.*` factories create per-room materials (must be disposed with the room), a handful of `Mats.*` constants are shared forever. Materials are `MeshStandardMaterial` (per-pixel lit) rather than `MeshLambertMaterial` (per-vertex/Gouraud) — on a large unsubdivided box face, Lambert's vertex-only lighting creates a visible hard seam along the diagonal between the face's two triangles wherever a point light sits mid-face. Also worth knowing if you touch lighting: Three.js r155+ defaults to physically-correct falloff (`decay=2`), where intensity is candela-scale — old "intensity: 1-2" values render as near-total darkness. See the tuned values in `rooms.js`'s `LAMP_BASE_INT`, `items.js`'s `FLASH_ON_INTENSITY`, and `main.js`'s scene lights.
- **`audio.js`** — `Sfx`, a fully synthesized sound engine (oscillators + filtered white noise, no audio files)
- **`input.js`**, **`player.js`**, **`hud.js`** — pointer-lock FPS controller, collision (cylinder-vs-AABB), and the entire UI (built as DOM, not canvas)
- **`rooms.js`** — builds one room's geometry from a `Frame` + options; every interactable it creates just forwards to `ctx.game.*` — it has no idea what a lock or gold pile *means*, only how to describe one and report the event. Its `box(cx, cz, sx, sz, cy, sy, material, castShadow)` helper places a box with a deliberately floor-plan-friendly argument order — the two horizontal axes (center `x,z`, then size `x,z`) come *before* the vertical (center `y`, then height `y`), because rooms are authored as 2D layouts extruded upward; get the interleaving wrong and geometry silently lands in the wrong place
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
- Not yet implemented: a second floor (The Mines / Door 200+ content) and the
  modifier system from the Roblox version's design doc. `entities/` follows a
  uniform `update(dt, ctx)` state-machine pattern with the spawn table rolled
  in `director.js`, so adding a new hazard is mostly "write one more file and
  register it there" — which is exactly how the roster has kept growing
  (Rush, Ambush, Screech, Eyes, Halt, Figure, Dupe, Jack, Seek, Timothy).
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
