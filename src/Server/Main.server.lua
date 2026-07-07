-- Main (Script) -> ServerScriptService/DoorsServer/Main
--
-- Bootstrap: creates the RemoteEvents, wires every service together through
-- a shared context table (no circular requires), sets up players/leaderstats,
-- and builds the lobby. Also provides Studio-only chat commands for testing:
--   /rush  /ambush  /eyes  /screech  /reset  /gold

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)

local RoomGenerator = require(script.Parent.RoomGenerator)
local DoorService = require(script.Parent.DoorService)
local HidingService = require(script.Parent.HidingService)
local LightingService = require(script.Parent.LightingService)
local EntityService = require(script.Parent.EntityService)
local InventoryService = require(script.Parent.InventoryService)
local ItemService = require(script.Parent.ItemService)
local DataService = require(script.Parent.DataService)
local RunManager = require(script.Parent.RunManager)

----------------------------------------------------------------
-- Remotes
----------------------------------------------------------------
local remotesFolder = Instance.new("Folder")
remotesFolder.Name = "Remotes"

local Remotes = {}
for _, name in { "RoomChanged", "Notify", "EntityCue", "HideState", "DeathScreen", "WinScreen", "EntityReport" } do
	local remote = Instance.new("RemoteEvent")
	remote.Name = name
	remote.Parent = remotesFolder
	Remotes[name] = remote
end
remotesFolder.Parent = ReplicatedStorage

----------------------------------------------------------------
-- Service wiring
----------------------------------------------------------------
local ctx = {
	Config = Config,
	Remotes = Remotes,
	RoomGenerator = RoomGenerator,
	DoorService = DoorService,
	HidingService = HidingService,
	LightingService = LightingService,
	EntityService = EntityService,
	InventoryService = InventoryService,
	ItemService = ItemService,
	DataService = DataService,
	RunManager = RunManager,
}

LightingService.init(ctx)
DataService.init(ctx)
InventoryService.init(ctx)
ItemService.init(ctx)
DoorService.init(ctx)
HidingService.init(ctx)
EntityService.init(ctx)
RoomGenerator.init(ctx)
RunManager.init(ctx)

Remotes.EntityReport.OnServerEvent:Connect(function(player, entityName, payload)
	if typeof(entityName) == "string" then
		EntityService.onReport(player, entityName, payload)
	end
end)

----------------------------------------------------------------
-- Players
----------------------------------------------------------------
Players.RespawnTime = Config.RespawnDelay

local function onCharacterAdded(player: Player, character: Model)
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	local hrp = character:WaitForChild("HumanoidRootPart") :: BasePart
	humanoid.WalkSpeed = Config.WalkSpeed
	player:SetAttribute("Hidden", false)
	player:SetAttribute("LastKilledBy", nil)

	task.defer(function()
		hrp.CFrame = RunManager.getSpawnCFrame()
	end)

	humanoid.Died:Connect(function()
		RunManager.onPlayerDied(player)
	end)
end

local COMMANDS = {
	["/rush"] = function()
		EntityService.forceSpawn("Rush")
	end,
	["/ambush"] = function()
		EntityService.forceSpawn("Ambush")
	end,
	["/eyes"] = function()
		EntityService.forceSpawn("Eyes")
	end,
	["/screech"] = function()
		EntityService.forceSpawn("Screech")
	end,
	["/reset"] = function()
		RunManager.resetRun()
	end,
	["/gold"] = function(player)
		InventoryService.addGold(player, 500)
	end,
}

Players.PlayerAdded:Connect(function(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	for _, statName in { "Room", "Gold", "Knobs" } do
		local value = Instance.new("IntValue")
		value.Name = statName
		value.Parent = stats
	end
	stats.Parent = player

	DataService.setupPlayer(player)
	InventoryService.setupPlayer(player)

	if Config.FirstPerson then
		player.CameraMode = Enum.CameraMode.LockFirstPerson
	end

	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
	if player.Character then
		onCharacterAdded(player, player.Character)
	end

	-- Studio-only test commands
	if RunService:IsStudio() then
		player.Chatted:Connect(function(message)
			local command = COMMANDS[string.lower(message)]
			if command then
				command(player)
			end
		end)
	end
end)

Players.PlayerRemoving:Connect(function(player)
	HidingService.removePlayer(player)
	EntityService.removePlayer(player)
	InventoryService.removePlayer(player)
	DataService.removePlayer(player)
end)

----------------------------------------------------------------
-- Boot: build the lobby (room 0)
----------------------------------------------------------------
RunManager.resetRun()
print("[DoorsGame] Server ready. Open the door marked 1 to begin.")
