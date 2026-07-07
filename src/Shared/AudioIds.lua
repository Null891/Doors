-- AudioIds (ModuleScript) -> ReplicatedStorage/Shared/AudioIds
--
-- Every sound in the game is looked up here by name. All ids ship as 0,
-- which SoundUtil treats as "no sound yet" and silently skips, so the game
-- runs fine before you add audio.
--
-- To fill these in: Studio Toolbox -> Audio (Creator Store audio is licensed
-- for use in any experience) -> search the suggested term -> right-click ->
-- Copy Asset ID -> paste the number below.

local AudioIds = {
	-- Doors                          -- Toolbox search suggestion
	DoorOpen = 0, -- "door open creak"
	DoorLocked = 0, -- "locked door handle rattle"
	DoorUnlock = 0, -- "key unlock door"

	-- Items / economy
	KeyPickup = 0, -- "key pickup jingle"
	GoldPickup = 0, -- "coins pickup"
	Purchase = 0, -- "cash register purchase"
	CrucifixBanish = 0, -- "chains rattle magic"

	-- Lights
	LightSwitch = 0, -- "light switch click"
	LightShatter = 0, -- "glass shatter small"

	-- Hiding
	ClosetIn = 0, -- "wardrobe door close"
	ClosetOut = 0, -- "wardrobe door open"
	Heartbeat = 0, -- "heartbeat loop"
	HideWhisper = 0, -- "creepy whisper" (the GET OUT warning)

	-- Rush / Ambush
	RushAmbience = 0, -- "monster roar distorted" (loud, attached to the entity)
	AmbushAmbience = 0, -- "distorted screaming loop"
	Jumpscare = 0, -- "horror sting scream" (played on your death)

	-- Screech / Eyes
	ScreechPsst = 0, -- "psst whisper"
	ScreechScream = 0, -- "short monster screech"
	ScreechBite = 0, -- "bite flesh impact"
	EyesAmbience = 0, -- "eerie tone loop"
	EyesDamage = 0, -- "psychic damage zap"

	-- Run flow
	ElevatorDing = 0, -- "elevator ding"
	WinMusic = 0, -- "victory jingle dark"
	AmbienceLoop = 0, -- "dark ambience horror loop"
}

return AudioIds
