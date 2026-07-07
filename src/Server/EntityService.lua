-- EntityService (ModuleScript) -> ServerScriptService/DoorsServer/EntityService
--
-- The spawn director. Every opened door rolls the entity table:
--   * Rush / Ambush - hallway sweepers (Rush.lua handles both variants)
--   * Eyes          - look-away hazard parked in a room
--   * Screech       - hunts players who linger in dark rooms (self-managing)
-- Safe rooms (shop, elevator, lobby) never spawn anything.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)

local Rush = require(script.Parent.Entities.Rush)
local Screech = require(script.Parent.Entities.Screech)
local Eyes = require(script.Parent.Entities.Eyes)

local EntityService = {}
local ctx
local rng = Random.new()
local lastSweepRoom = -100

function EntityService.init(context)
	ctx = context
	Rush.init(context)
	Screech.init(context)
	Eyes.init(context)
end

-- A sweeper is only fair if there's somewhere to hide in the freshly
-- loaded stretch of rooms.
local function closetAvailable(): boolean
	local rooms = ctx.RoomGenerator.getActiveRooms()
	for i = math.max(1, #rooms - 2), #rooms do
		if #rooms[i].closets > 0 then
			return true
		end
	end
	return false
end

function EntityService.onDoorOpened(newRoom, opener: Player?)
	local number = newRoom.number
	if newRoom.isShop or newRoom.isElevator or number < 1 then
		return
	end
	if Rush.isActive() then
		return
	end

	-- Sweepers (Rush, escalating to Ambush later in the run)
	if number - lastSweepRoom >= Config.Rush.MinRoomsBetween and closetAvailable() then
		local rushChance = math.min(Config.Rush.BaseChance + number * Config.Rush.ChancePerRoom, Config.Rush.MaxChance)
		if rng:NextNumber() < rushChance then
			lastSweepRoom = number
			task.delay(0.5, Rush.spawn, "Rush")
			return
		elseif number >= Config.Ambush.MinRoom and rng:NextNumber() < Config.Ambush.Chance then
			lastSweepRoom = number
			task.delay(0.5, Rush.spawn, "Ambush")
			return
		end
	end

	-- Eyes parks itself in the new room
	if number >= Config.Eyes.MinRoom and rng:NextNumber() < Config.Eyes.Chance then
		Eyes.spawn(newRoom)
	end
end

function EntityService.onRoomCulled(record)
	Eyes.onRoomCulled(record)
end

function EntityService.onRunReset()
	lastSweepRoom = -100
	Eyes.despawnAll()
end

-- Routes client reports (camera checks the server can't do itself)
function EntityService.onReport(player: Player, entityName: string, payload)
	if entityName == "Screech" then
		Screech.onReport(player)
	elseif entityName == "Eyes" then
		Eyes.onReport(player, payload == true)
	end
end

function EntityService.removePlayer(player: Player)
	Screech.removePlayer(player)
end

-- Studio testing / chat commands
function EntityService.forceSpawn(name: string)
	if name == "Rush" or name == "Ambush" then
		if not Rush.isActive() then
			Rush.spawn(name)
		end
	elseif name == "Eyes" then
		Eyes.spawn(ctx.RoomGenerator.getCurrentRoom())
	elseif name == "Screech" then
		Screech.forceAttack()
	end
end

return EntityService
