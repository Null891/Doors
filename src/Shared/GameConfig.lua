-- GameConfig (ModuleScript) -> ReplicatedStorage/Shared/GameConfig
-- Central tuning table. Server and client both read from here so every
-- gameplay number lives in exactly one place.

local GameConfig = {
	----------------------------------------------------------------
	-- Room generation
	----------------------------------------------------------------
	MaxLoadedRooms = 5, -- rooms kept alive behind the group (DOORS keeps ~5)
	RoomWidth = 26,
	RoomHeight = 16,
	DoorwayWidth = 8,
	DoorwayHeight = 11,
	SideExitInset = 8, -- side-wall doors sit this far back from the far wall

	LockedDoorChance = 0.15, -- chance the exit door is locked (key spawns in room)
	LockedDoorMinRoom = 4, -- never lock doors before this room number

	MaxClosetsPerRoom = 3,
	ClosetChance = 0.65, -- per candidate wall slot
	LightSwitchChance = 0.4,
	LightSpacing = 18, -- one ceiling lamp per N studs of room length

	DarkRoomChance = 0.08, -- random unlit rooms (Screech territory)
	DarkRoomMinRoom = 10,
	GreenhouseStart = 90, -- rooms 90..99 are always dark, like the Greenhouse
	ShopRoom = 52, -- Jeff's shop: safe room, no entity spawns
	FinalRoom = 100, -- opening this door ends the floor (elevator room)

	GoldPileChance = 0.55, -- per room; piles hold GoldMin..GoldMax
	GoldMin = 5,
	GoldMax = 40,

	----------------------------------------------------------------
	-- Hiding
	----------------------------------------------------------------
	MaxHideTime = 10, -- seconds inside a closet before the "GET OUT" warning
	GetOutGrace = 1.5, -- seconds after the warning before Hide throws you out
	ForceOutDamage = 10,

	----------------------------------------------------------------
	-- Entities
	----------------------------------------------------------------
	Rush = {
		BaseChance = 0.07, -- spawn chance at room 1
		ChancePerRoom = 0.0035, -- chance grows as the run progresses
		MaxChance = 0.35,
		MinRoomsBetween = 3, -- cooldown (doors opened) between sweeper spawns
		WarningTime = 2.6, -- lights flicker for this long before the sweep
		Speed = 44, -- studs per second
		KillRadius = 9,
		Damage = 125,
		DespawnOvershoot = 40, -- studs past the newest door before despawning
		BreaksLights = true,
	},

	Ambush = {
		Chance = 0.06, -- rolled only when the Rush roll fails, after MinRoom
		MinRoom = 30,
		WarningTime = 2.2,
		Speed = 55,
		KillRadius = 9,
		Damage = 125,
		ReboundsMin = 2, -- extra passes back and forth
		ReboundsMax = 6,
		ReboundPause = { 1.0, 2.5 }, -- off-screen pause between passes {min, max}
		BreaksLights = false,
	},

	Screech = {
		Chance = 0.35, -- rolled per player per dark room entered
		Cooldown = 20, -- per-player seconds between attempts
		LookWindow = 2.5, -- seconds to get it on screen after the "psst"
		Damage = 40,
	},

	Eyes = {
		Chance = 0.06, -- rolled per door opened (skipped on shop/boss rooms)
		MinRoom = 15,
		DamagePerTick = 10,
		TickRate = 0.4, -- seconds between damage ticks while you look at it
	},

	VoidDamage = 20, -- straggler damage when their room is culled from memory

	GuidingLightDelay = 45, -- seconds stuck in a locked room before the key glows

	----------------------------------------------------------------
	-- Items & economy
	----------------------------------------------------------------
	ShopPrices = { -- gold, mid-run at Jeff's shop (room 52)
		Flashlight = 100,
		Lockpick = 150,
		Vitamins = 75,
		Crucifix = 300,
	},
	LobbyPrices = { -- knobs, pre-run pedestals in the lobby
		Flashlight = 15,
		Lockpick = 20,
		Vitamins = 10,
	},

	FlashlightSeconds = 120, -- full battery life
	VitaminsSpeedBoost = 8, -- added WalkSpeed
	VitaminsDuration = 15,
	CrucifixRange = 14, -- banish distance vs sweepers

	GoldPerKnob = 20, -- end-of-run conversion; remainder >= 10 rounds up
	KnobsPerTenDoors = 1, -- progress bonus
	WinBonusKnobs = 15, -- flat bonus for escaping at door 100

	----------------------------------------------------------------
	-- Player
	----------------------------------------------------------------
	WalkSpeed = 16,
	CrouchSpeed = 8, -- reserved for the Figure expansion (see README)
	RespawnDelay = 4,
	FirstPerson = false, -- true = lock camera to first person
}

return GameConfig
