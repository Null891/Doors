# DOORS-like — a complete, playable Roblox horror game

A full DOORS-inspired game written in Luau with **zero assets required** — every
room, door, closet, entity, item, and UI element is generated procedurally in
code. Paste it into Studio (or sync with Rojo), press Play, and you have a
working run from the Lobby to the Door 100 elevator escape.

## What's in the game

| System | Details |
|---|---|
| Procedural generation | Weighted room templates (hallways, grand halls, 90° turns), last-5-rooms kept in memory, overlap detection with re-rolls, Void straggler teleport when rooms cull |
| Doors & locks | Numbered doors, ~15% locked with a key hidden in the room, lockpicks, Guiding Light makes the key glow if the group is stuck 45s |
| Hiding | Closets with occupancy, letterbox+FOV effect, and the **Hide** entity: camp too long → "GET OUT" → thrown out with damage |
| **Rush** | Light flicker + heartbeat warning, sweeps every loaded room oldest→newest at 44 studs/s, shatters lights, kills anyone not hidden (125 dmg) |
| **Ambush** | Faster (55), spares the lights, rebounds 2–6 extra passes so you must cycle in/out of closets |
| **Screech** | Hunts players in dark rooms (random dark rooms + the always-dark 90–99 "Greenhouse" stretch). "Psst" behind you → look at it within 2.5s or take 40 dmg |
| **Eyes** | Purple cluster parked mid-room; looking at it ticks 10 dmg. Client reports camera state, server validates position |
| Items | Flashlight (draining battery), Vitamins (speed boost), Lockpick, **Crucifix** (banishes Rush/Ambush on contact) — all procedural Tools |
| Economy | Gold piles in rooms → Jeff's Shop safe room at Door 52 (gold prices) → on death/escape gold converts to **Knobs** (20:1, remainder ≥10 rounds up, +1 per 10 doors, +15 win bonus), persisted via DataStore, spent at lobby pedestals |
| Run flow | Full-wipe resets the hotel, Door 100 is an elevator room — pull the lever, everyone alive gets paid and the run resets. Death screen with per-entity tips |

## Quick start

### Option A — Rojo (this folder is a ready project)
```
rojo init  # not needed, default.project.json is included
rojo serve # then connect from the Rojo plugin in Studio
```

### Option B — manual copy-paste into Studio
Create these instances and paste each file's contents into the matching script.
**The Instance name must match the filename without extension** (e.g.
`Main.server.lua` → a `Script` named `Main`).

| Studio location | Instance | From file |
|---|---|---|
| ReplicatedStorage → Folder `Shared` | ModuleScript `GameConfig` | src/Shared/GameConfig.lua |
| " | ModuleScript `AudioIds` | src/Shared/AudioIds.lua |
| " | ModuleScript `SoundUtil` | src/Shared/SoundUtil.lua |
| " | ModuleScript `RoomTemplates` | src/Shared/RoomTemplates.lua |
| ServerScriptService → Folder `DoorsServer` | **Script** `Main` | src/Server/Main.server.lua |
| " | ModuleScript `RoomGenerator` | src/Server/RoomGenerator.lua |
| " | ModuleScript `DoorService` | src/Server/DoorService.lua |
| " | ModuleScript `HidingService` | src/Server/HidingService.lua |
| " | ModuleScript `LightingService` | src/Server/LightingService.lua |
| " | ModuleScript `EntityService` | src/Server/EntityService.lua |
| " | ModuleScript `InventoryService` | src/Server/InventoryService.lua |
| " | ModuleScript `ItemService` | src/Server/ItemService.lua |
| " | ModuleScript `DataService` | src/Server/DataService.lua |
| " | ModuleScript `RunManager` | src/Server/RunManager.lua |
| DoorsServer → Folder `Entities` | ModuleScript `Rush` | src/Server/Entities/Rush.lua |
| " | ModuleScript `Screech` | src/Server/Entities/Screech.lua |
| " | ModuleScript `Eyes` | src/Server/Entities/Eyes.lua |
| StarterPlayer → StarterPlayerScripts → Folder `DoorsClient` | **LocalScript** `ClientMain` | src/Client/ClientMain.client.lua |
| " | ModuleScript `UIBuilder` | src/Client/UIBuilder.lua |
| " | ModuleScript `CameraShake` | src/Client/CameraShake.lua |

Then:
1. **Delete** the default `Baseplate` and any `SpawnLocation` (the game builds
   its own world at the origin and teleports players itself).
2. For knob persistence: Game Settings → Security → **Enable Studio Access to
   API Services** (the game still runs without it; knobs just won't save).
3. Press **Play**. You spawn in the lobby — open the door marked **1**.

### Studio test commands (chat, Studio only)
`/rush` `/ambush` `/eyes` `/screech` `/reset` `/gold` (grants 500 gold)

## Adding sound
Everything is silent until you fill in `ReplicatedStorage/Shared/AudioIds`.
Each entry has a Toolbox search suggestion in a comment — grab any Creator
Store audio (licensed for all experiences), Copy Asset ID, paste the number.
Id `0` = skipped gracefully, so fill them in incrementally.

## How it works (architecture)

**Server owns everything gameplay.** Clients only receive cues and send two
camera reports the server physically cannot compute (camera orientation never
replicates): "Screech is on my screen" and "Eyes is on my screen". Both are
validated server-side for timing/position, and neither can be exploited to
*hurt* other players — lying only saves yourself from a cosmetic-check entity.

**Wiring:** `Main` creates the RemoteEvents, requires every service module,
and passes one shared `ctx` table to each `init()` — no circular requires.

**Generation math:** every room is built in a local space whose origin is the
entry doorway (x=right, z=depth). A room's exit doorway CFrame (looking
outward) becomes the next room's base, so turns compose naturally. Because
all yaw is in 90° steps, room footprints are axis-aligned boxes — overlap
checks are cheap AABB tests, re-rolled up to 8 times before falling back to a
straight hallway.

**Rush's path** is just each loaded room's entry/exit points at chest height,
concatenated oldest→newest plus a 40-stud overshoot; a Heartbeat loop steps
the position at fixed studs/sec and radius-checks every non-`Hidden` player.
Ambush reuses the exact same machinery with a rebound loop around it.

**Remotes:** `RoomChanged`, `Notify`, `EntityCue(name, phase, data?)`,
`HideState("in"|"out"|"warn")`, `DeathScreen`, `WinScreen`, and client→server
`EntityReport`.

**Tuning:** every number (spawn chances, speeds, damage, prices, room sizes)
lives in `GameConfig.lua`. New room shapes go in `RoomTemplates.lua`.

## Expanding: more entities & floors

The `EntityService.onDoorOpened` roll table + the `ctx` pattern means each new
entity is one ModuleScript plus one roll. Recipes, in rough build order:

- **Halt** — easiest: on spawn, teleport the player into a long dark corridor
  room (build with `buildRoom`-style parts), flash "TURN AROUND" cues via
  `EntityCue`, and damage on wrong movement direction (compare
  `humanoid.MoveDirection` with the corridor axis).
- **Dupe** — when a template rolls, add 1–2 fake exit doors with wrong
  numbers on side walls. Their prompt deals 40 damage and shakes the camera.
  All the door-building code in `RoomGenerator.makeDoor` is reusable.
- **A-60 / A-90** — A-60 is Rush with no light flicker (audio-only cue) and a
  faster despawn; A-90 is pure client+server input check: `EntityCue` shows
  the stop sign, client reports any input via `EntityReport`, server damages.
- **Jack** — occupies a random closet; entering it flashes a jumpscare
  (`EntityCue`) and throws the player out. ~30 lines inside `HidingService`.
- **Figure (Door 50 / library boss)** — add a `Crouch` remote that halves
  `WalkSpeed` (constant already in `GameConfig`) and set a `Noisy` attribute
  from movement/interactions. The Figure is a Model pathfinding toward the
  loudest recent noise position (`PathfindingService`), instant-kill on touch
  unless hidden; hiding while it's near triggers a heartbeat minigame
  (client-side timing UI → report result). Build the library as a fixed
  set-piece room injected at `number == 50` in `generateNext` — the same hook
  the shop (52) and elevator (100) already use, with the book/code puzzle
  gating the exit door's `Locked` attribute.
- **Seek chase (Doors 30–40 style)** — generate 6–8 rooms ahead at once, then
  a scripted chase: a moving kill-wall behind the players using the same
  path-node traversal as Rush, with `TweenService` obstacles to dodge.
- **Floor 2 (Mines)** — swap `STYLE` colors/materials to rock+metal, add
  vertical `lcf` offsets between rooms (the base-CFrame chaining already
  supports it), and introduce Grumbles as `PathfindingService` patrol agents
  with line-of-sight raycasts and a last-known-position memory.
- **Modifiers** — a lobby pedestal that writes multipliers into a
  `RunModifiers` table read by `GameConfig` consumers (e.g. Lights Out:
  `DarkRoomChance = 1`, payout ×1.25).

## Performance & best practices already applied
- Rooms are capped at `MaxLoadedRooms`; everything in a room dies with its
  single Model (`Destroy` cascades — no leaked connections to world objects).
- All world interaction uses ProximityPrompts (built-in UI, range-gated),
  re-validated server-side (distance, occupancy, currency, locks).
- Lights use `Shadows = false` point lights; entity movement is one anchored
  `PivotTo` per frame (no physics).
- DataStore calls are pcall-wrapped, throttled (60s autosave + leave/close).
