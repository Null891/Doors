# ROADMAP — Making "A Hundred Doors" a True Mirror of Roblox DOORS

This is the working plan for future sessions (Opus/Sonnet). It lists everything
still wanted, in priority order, with enough context that a fresh session can
pick any item and execute it safely. **Read "House Rules" first — they encode
hard-won lessons from real bugs in this codebase.**

---

## House Rules (read before touching anything)

1. **Never trust code that merely doesn't throw.** After ANY change, run:
   - `node --check <file>` on every touched file,
   - the full 100-room simulation (`director-smoketest.mjs` pattern: stub
     `document.createElement('canvas')`, drive real World/Player/Director for
     100 rooms; must end ALL CHECKS PASSED with kills across several entities),
   - for visual work: a headless-Chromium screenshot actually *looked at*
     (playwright-core lives in `web/node_modules`; launch args
     `['--use-gl=swiftshader','--ignore-gpu-blocklist','--enable-webgl','--no-sandbox']`).
2. **Lighting is physically correct** (Three r155+): PointLight/SpotLight use
   `decay=2` and candela-scale intensity — HUNDREDS (lamps use 480, flashlight
   320), never 1–2. Low values render pitch black.
3. **`box(cx, cz, sx, sz, cy, sy, mat)`** in rooms.js — a swapped `sz/sy` once
   created an invisible box the camera spawned inside ("everything is black").
   Triple-check argument order.
4. **`THREE.DoubleSide` does not flip UVs** — text planes read mirrored from
   behind. Compute inward-facing yaw via `rightOf(frame)` (see door plates).
5. **Any material added to the shared `Mats` block** in textures.js MUST be
   registered in `isSharedMaterial()` in rooms.js, or room culling disposes a
   material other rooms still use.
6. **Every audio method must start `if (!this.ctx) return;`** — the Node sim
   has no AudioContext; a missing guard is a guaranteed sim crash.
7. **CSS animation shorthand doesn't merge across co-applied classes** — the
   higher-specificity rule silently drops the other's animation. Combined
   classes need an explicit compound rule (see `.btn.primary.reveal-play`).
8. **Multi-agent work**: give each agent EXCLUSIVE file ownership; reserve
   `main.js`, `entities/director.js`, `config.js`, `world.js`, `input.js` for
   the orchestrator; agents return "WIRING NEEDED" instructions instead of
   editing shared files. Entity public APIs (`trigger/update/reset/get active`)
   must not change shape.
9. `Frame {x,z,dir}` quarter-turn coordinate system: all geometry axis-aligned;
   place things with `toWorld(frame, dx, dz)`; `meshYaw()` (rooms.js) vs
   `yawOfDir()` (camera) are deliberately different sign conventions.
10. Zero external assets, ever: no CDNs, fonts, images, samples. Textures are
    canvas-painted; audio is synthesized; icons are emoji/CSS.

---

## Current state (what's DONE and verified as of this commit)

- **Entities**: Rush, Ambush (audio-only warning, breaks lights mid-charge),
  Screech (look-at-to-survive; lit flashlight lowers odds), Eyes (scatter on
  door-open), Halt (corridor-chase: TURN AROUND / RUN AWAY rounds), Figure
  (blind, hearing-based, library + patrol, stay-still closet sniff), Dupe
  (fake doors), Jack (closet scare, no damage), **Seek** (breadcrumb-trail
  chase with grabbing-arm wall dressing, 2 rolled doors/run: ~30s and ~60s-70s),
  **Timothy** (spider closet jumpscare, hard-floored nibble), **Ambient scares**
  (doorway silhouette, watching portrait eyes, whisper+dim, darting shadow).
- **Rooms**: procedural hotel (wallpaper/carpet/wainscot palettes tuned to
  DOORS), lobby w/ broken elevator + reception desk + bell + plant, Greenhouse
  90–99 (mossy walls, vines, planters, no carpet/paintings), furniture pool
  (couch/table/shelf) in leftover closet slots, Library (door 50) code hunt +
  padlock, Jeff's Shop (door 52) now selling all 6 items, Electrical room
  (door 100) with 10-switch hunt + 3-round memory breaker + mystery switch.
- **Systems**: 6-slot hotbar w/ scroll cycling, gold→knobs economy, lobby knob
  shop, save-code export/import (checksummed), Guiding-Light key hint after
  `CFG.guidingLightDelay`, flashlight low-battery flicker, bandage/battery
  items, vitamins sprint-boost, crucifix (banishes Rush/Ambush/Seek), hide
  timeout + re-hide cooldown, Void straggler damage.
- **Player feel**: velocity-smoothed movement, strafe lean, FOV kick,
  **sprint + stamina** (Shift; bar auto-hides when full), crouch w/ audio cue.
- **HUD**: glass-panel room/currency/objective displays, animated room-number
  bump, currency pulse-on-gain, 6-slot hotbar with count badges/meters/
  low-battery pulse/pickup flash, crosshair with interactable highlight state,
  boxed [E] prompts, critical-health heartbeat vignette, **danger vignette**
  (`setDanger`), **stamina bar** (`setStamina`), **loading overlay**
  (`showLoading/hideLoading`, shown 1.1s on ENTER THE HOTEL), per-entity
  procedural jumpscare faces incl. seek/timothy, menu with live 3D lobby
  backdrop + save-code UI.
- **Audio**: all synthesized — ambience w/ tension layer, rush loop w/
  proximity crossfade, Shepard-tone Ambush scream, whisper, seek rumble loop,
  timothy screech, material-aware footsteps (`step(crouched, surface)`),
  reverb/distortion helpers.

**Known small gaps from this session** (agents died mid-task; safe to redo):
- `Sfx.step` accepts a `surface` param but callers never pass carpet/wood info.
- `game?.onFootstep?.(crouched)` is called by player.js but main.js never
  defines `onFootstep` — harmless no-op today (Figure hears via proximity
  polling); wiring it would let Figure react to *discrete* steps.
- ~~No heartbeat audio loop~~ DONE (commit b7f768e): `Sfx.heartbeat()` handle,
  driven by hunts/dark rooms/low HP in main.js, silent outside play.
- README was refreshed but does not yet document Seek/Timothy/ambient/sprint.

---

## PRIORITY 1 — Feel & fairness (biggest playability wins)

1. **Seek balance pass in a real browser** (nobody has played the chase yet,
   only simulated it): tune `SEEK_SPEED/START_GAP/SEEK_ROOMS` in seek.js so an
   average player sprinting survives and a staller dies. Verify sprint stamina
   is enough for the whole chase (it should *just barely* be).
2. **Figure encounter depth** (its agent died before editing): investigate
   state with a listening pause + head-turn, gradual give-up, escalating
   awareness; growl/breath proximity audio; keep `activate/onInteractionNoise/
   onBookRead/update/reset` API identical (library.js depends on it).
3. ~~Wire `onFootstep`~~ **DONE** (commit d3190b8): uncrouched steps ping the
   Figure within `hearWalk`; sprinting carries 1.7x farther; crouched silent.
   Remaining sub-item: pass surface (`room.isGreenhouse ? 'stone' : carpeted ?
   'carpet' : 'wood'`) through to `Sfx.step` (param exists, unused).
4. **Death → spectate beat**: real DOORS shows a brief entity-specific death
   cam/quote before the stats screen. Add a 1.5s black beat with the entity's
   scare face + a whispered quote before `showDeath`. (There is already a
   0.9s scare-face beat in `killPlayer` — extend it, don't stack another.)
5. ~~Elevator win sequence~~ **DONE** (commit b7f768e): lever → caption, door
   slam, fade-to-black under shake, then stats fade in. Could still add a
   proper win fanfare melody (see #25).

## PRIORITY 2 — Missing DOORS content (most-requested authenticity)

6. **El Goblino & Jeff NPCs in the shop** (door 52): friendly NPC blobs w/
   idle sway + interaction barks ("El Goblino was here"); pure flavor, no AI.
7. **The Dark Rooms item + lighter/candle**: candle reveals Screech sooner /
   calms dark rooms; lighter as a cheap flashlight tier. Slot into the
   existing 6-item economy (shop + lobby prices in config.js).
8. **Herb of Viridis / Starlight Bottle equivalents**: one more heal tier and
   a "revive once" rare item (real DOORS sells revives; here make it a very
   expensive knob purchase in the lobby).
9. **Locked-room variety**: real DOORS hides keys in drawers/under objects;
   add 1–2 alternate key placements (on a shelf, inside a closet) so locked
   rooms aren't always pedestal-in-the-open.
10. **Room templates**: an L-shaped double-turn, a small side-room alcove with
    loot, and a rare two-story balcony room (stairs = ramps; still AABB).
    Follow `TEMPLATES` in world.js + the footprint-overlap reroll pattern.
11. **The Courtyard beat (door 60)**: a one-off outdoor-feeling room (skybox
    color shift, rain audio, fountain) as a mid-run landmark, like the real
    game's greenhouse/courtyard set pieces.
12. **A-90/A-60-style modifier** for post-100 (see #17) or hard mode.

## PRIORITY 3 — Environment & rendering polish

13. **Chandeliers/sconces/grand-hall dressing** (env agent died researching
    this): pendant fixtures in `GrandHall` template rooms (length ≥ 64),
    wall sconces between paintings, columns/pilasters; all candela-scale.
14. **Window rooms**: occasional curtained windows with cold moonlight shafts
    (a dim blue rect + volumetric-ish plane), matching DOORS' window rooms —
    also gives Ambient's silhouette a natural frame.
15. **Ceiling variety**: beams, cracks, an occasional hole with dust shaft.
16. **Sound-reactive lamp flicker**: lamps subtly dip when thunder/whisper
    beats fire (LightingService-style mood sync).

## PRIORITY 4 — Meta & systems

17. **Post-100 endless mode**: after the win, offer "keep descending" with
    scaling hazard chances (real DOORS has The Rooms/Backdoor extensions) —
    world.js already generates arbitrary numbers; gate entity chances by
    `number % 100`.
18. **Achievements & stats page**: deaths by entity, fastest run, doors
    opened lifetime (localStorage + save-code v2 — bump the version field,
    keep import back-compat with v1).
19. **Settings menu**: volume sliders exist; add FOV, mouse-sensitivity
    fine value, reduced-flash accessibility toggle, colorblind-safe prompt
    colors.
20. **Mobile/touch controls**: virtual joystick + look-drag + context button;
    the HUD is DOM so this is tractable; pointer-lock code needs a touch path.
21. **Performance pass**: merge static room geometry (BufferGeometryUtils is
    in the vendored build) — target consistent 60fps on integrated GPUs at
    4-room load.

## PRIORITY 5 — Audio & narrative seasoning

22. ~~Heartbeat loop~~ **DONE** (commit b7f768e).
23. **Guiding Light / Curious Light narration**: real DOORS shows soft
    letter-by-letter guidance text after deaths and at set pieces. Add a
    `hud.narrate(text)` letter-reveal caption in the Guiding Light gold, used
    on first Rush death, first locked room, Seek intro, and the win.
24. **Entity-specific death quotes** on the death screen (wiki has canonical
    Guiding Light hints per entity — paraphrase, don't copy verbatim).
25. **Music stingers**: the shop's calm loop ("Jeff's Jingle" vibe), the
    library's tense drone, elevator win fanfare — all synthesized.

---

## Verification checklist to run before ANY push

```
cd web/game && for f in *.js entities/*.js; do node --check "$f"; done
cd web && node <scratchpad>/director-smoketest.mjs     # ALL CHECKS PASSED
cd web && node <scratchpad>/room-decor-smoketest.mjs   # SMOKETEST PASSED
cd web && node <scratchpad>/electrical-test.mjs        # ALL CHECKS PASSED
# headless boot: zero pageerror/console-error, menu visible, screenshot looked at
```

(The scratchpad test scripts are session-local; if missing, recreate from the
patterns described in House Rule #1 — ~80 lines each, stub only
`document.createElement('canvas')`.)
