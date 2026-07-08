// config.js — every gameplay number in one place.
// Units: 1 unit = 1 "stud". Speeds are units/second. Times are seconds.

export const CFG = {
  // ---- rooms ----------------------------------------------------
  room: {
    W: 26,               // standard room width
    H: 16,               // wall height
    doorW: 8,
    doorH: 11,
    sideInset: 8,        // side-wall exits sit this far before the far wall
    maxLoaded: 4,        // rooms kept alive behind the player
    lockedChance: 0.16,
    lockedMinRoom: 4,
    darkChance: 0.09,    // random unlit rooms (Screech territory)
    darkMinRoom: 9,
    greenhouseStart: 90, // 90..99 always dark
    shopRooms: [22, 52, 78], // Jeff's Shop appears three times so gold is
                             // spendable early / mid / late, not just once
    libraryRoom: 50,
    finalRoom: 100,
    goldChance: 0.6,
    goldMin: 6,
    goldMax: 45,
    maxClosets: 3,
    closetChance: 0.62,
    paintingChance: 0.5,
    voidDamage: 20, // straggler damage when a lagging player's room gets culled
  },

  // ---- player ---------------------------------------------------
  player: {
    walk: 14,
    crouchMult: 0.5,
    radius: 1.3,
    eyeStand: 4.4,
    eyeCrouch: 2.7,
    health: 100,
    stepLen: 3.4,        // distance between footsteps
  },

  // ---- hiding / Hide entity --------------------------------------
  // Real DOORS forces you out of a closet within ~5-6s and blocks re-hiding
  // for ~12.5s after — camping a closet isn't a real strategy there either.
  hide: {
    maxTime: 4.5,
    grace: 1.0,
    damage: 10,
    rehideCooldown: 12.5,
  },

  // ---- entities --------------------------------------------------
  rush: {
    baseChance: 0.08,
    perRoom: 0.0035,
    maxChance: 0.4,
    minRoomsBetween: 3,
    warnTime: 2.9,
    speed: 46,
    killDist: 6.5,
    damage: 125,
    overshoot: 40,
  },
  ambush: {
    minRoom: 30,
    chance: 0.07,
    warnTime: 2.3,
    speed: 58,
    killDist: 6.5,
    damage: 125,
    reboundsMin: 2,
    reboundsMax: 4,
    pauseMin: 1.0,
    pauseMax: 2.2,
  },
  screech: {
    rollEvery: 4,        // seconds spent in a dark room per roll
    chance: 0.2,
    window: 2.5,         // time to center it in view after the psst
    lookDot: 0.88,       // how directly you must look at it
    damage: 40,
    cooldown: 14,
  },
  eyes: {
    minRoom: 12,
    chance: 0.07,
    tick: 0.4,
    damage: 10,
    lookDot: 0.45,
  },
  halt: {
    minRoom: 38,
    chance: 0.06,
    corridorLen: 130,
    phasesMin: 3,
    phasesMax: 5,
    speed: 26,
    damage: 60,
  },
  dupe: {
    minRoom: 18,
    chance: 0.13,
    damage: 40,
  },
  jack: {
    minRoom: 25,
    chance: 0.09,
    blockTime: 30,
  },
  figure: {
    patrolSpeed: 8,
    chaseSpeed: 13.4,
    hearWalk: 22,        // hears uncrouched movement within this radius
    hearInteract: 30,
    senseClose: 5,       // senses you even crouched within this radius
    killDist: 3.4,
    books: 5,
    sniffTime: 4,        // stays at your closet this long
    speedPerBook: 0.5,
  },

  // Door 100's Circuit Breaker puzzle: collect switchCount switches
  // scattered around the electrical room, then solve a 3-round memory
  // sequence at the locked panel to restore power before the elevator
  // lever will work. Each round shows which switches should be ON for
  // `memorizeTime` seconds, then you toggle them from memory. Round 3's
  // final switch is a "mystery" — deduce it as the sum of that round's
  // other flipped switches (skip it if the sum is >10 or already used).
  electrical: {
    switchCount: 10,
    roundOnCounts: [3, 4, 4],   // how many switches are ON, per round
    memorizeTime: [6, 4.5, 3.5],
    inputTime: [14, 12, 12],
  },

  // ---- items / economy -------------------------------------------
  items: {
    flashlightBattery: 130,
    vitaminsBoost: 8,
    vitaminsTime: 15,
    crucifixRange: 13,
    bandageHeal: 40,
    batteryRestore: 0.5, // fraction of a full flashlight charge per battery
  },
  shopGold: { flashlight: 100, lockpick: 150, vitamins: 75, crucifix: 300, bandage: 60, battery: 45, candle: 40 },
  lobbyKnobs: { flashlight: 12, lockpick: 15, vitamins: 8, crucifix: 40, bandage: 7, battery: 5, candle: 4, revive: 100 },
  economy: {
    goldPerKnob: 20,
    knobsPerTenDoors: 1,
    winBonus: 20,
  },

  guidingLightDelay: 40, // seconds stuck in a locked room before the key glows

  fogNormal: 78,
  fogDark: 46,
};
