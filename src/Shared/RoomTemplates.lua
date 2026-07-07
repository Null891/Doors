-- RoomTemplates (ModuleScript) -> ReplicatedStorage/Shared/RoomTemplates
--
-- Data-driven room prefab definitions, picked by weighted random roll.
-- The generator builds all geometry procedurally from these numbers, so
-- adding a new room shape is usually just adding a table entry here.
--
--   exit = "end"   -> exit door on the far wall (random lateral offset)
--   exit = "left"  -> exit door on the left wall near the far end (90° turn)
--   exit = "right" -> exit door on the right wall near the far end
--
-- Higher weight = more common. Lengths are {min, max} in studs.

return {
	{ name = "Hallway", weight = 6, length = { 40, 60 }, exit = "end" },
	{ name = "GrandHall", weight = 2, length = { 64, 88 }, exit = "end" },
	{ name = "TurnLeft", weight = 2, length = { 36, 48 }, exit = "left" },
	{ name = "TurnRight", weight = 2, length = { 36, 48 }, exit = "right" },
}
