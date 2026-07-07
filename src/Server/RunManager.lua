-- RunManager (ModuleScript) -> ServerScriptService/DoorsServer/RunManager
--
-- Owns the run lifecycle: door-count stats, death payouts (gold -> knobs,
-- DOORS conversion: 20 gold per knob, remainder >= 10 rounds up, +1 knob per
-- 10 doors), full-wipe resets, and the elevator escape at door 100.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)

local RunManager = {}
local ctx

local currentRoomNumber = 0
local resetting = false
local escaped = false

local DEATH_TIPS = {
	Rush = "When the lights flicker, get in a closet - fast.",
	Ambush = "Ambush comes BACK. Leave the closet, then hide again for every pass.",
	Screech = "In dark rooms, listen for the 'psst' and LOOK at it quickly.",
	Eyes = "Do not look at Eyes. Watch the floor and walk past.",
	Hide = "Closets aren't a home. Get out before something makes you.",
	Void = "Don't fall behind the group.",
}

function RunManager.init(context)
	ctx = context
end

----------------------------------------------------------------
-- Knob math (DOORS conversion rules)
----------------------------------------------------------------
local function goldToKnobs(gold: number): number
	local knobs = math.floor(gold / Config.GoldPerKnob)
	if gold % Config.GoldPerKnob >= Config.GoldPerKnob / 2 then
		knobs += 1
	end
	return knobs
end

local function payout(player: Player, won: boolean): number
	local gold = ctx.InventoryService.takeAllGold(player)
	local knobs = goldToKnobs(gold)
	knobs += math.floor(currentRoomNumber / 10) * Config.KnobsPerTenDoors
	if won then
		knobs += Config.WinBonusKnobs
	end
	ctx.DataService.addKnobs(player, knobs)
	ctx.InventoryService.resetRun(player)
	return knobs
end

----------------------------------------------------------------
-- Run flow
----------------------------------------------------------------
function RunManager.onDoorOpened(newRoom)
	currentRoomNumber = newRoom.number
	for _, player in Players:GetPlayers() do
		local stats = player:FindFirstChild("leaderstats")
		local roomStat = stats and stats:FindFirstChild("Room")
		if roomStat and newRoom.number > roomStat.Value then
			roomStat.Value = newRoom.number
		end
	end
	if newRoom.isShop then
		ctx.Remotes.Notify:FireAllClients("Jeff's Shop - a safe place. Spend your gold.", Color3.fromRGB(120, 220, 120))
	elseif newRoom.isElevator then
		ctx.Remotes.Notify:FireAllClients("The elevator! Pull the lever to escape.", Color3.fromRGB(120, 200, 255))
		if newRoom.leverPrompt then
			newRoom.leverPrompt.Triggered:Connect(function(player)
				RunManager.win(player)
			end)
		end
	end
end

local function anyoneAlive(): boolean
	for _, player in Players:GetPlayers() do
		local char = player.Character
		local humanoid = char and char:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 then
			return true
		end
	end
	return false
end

function RunManager.resetRun()
	if resetting then
		return
	end
	resetting = true
	escaped = false
	currentRoomNumber = 0
	ctx.EntityService.onRunReset()
	for _, player in Players:GetPlayers() do
		ctx.HidingService.removePlayer(player)
	end
	ctx.RoomGenerator.reset()
	ctx.Remotes.RoomChanged:FireAllClients(0)
	for _, player in Players:GetPlayers() do
		local stats = player:FindFirstChild("leaderstats")
		local roomStat = stats and stats:FindFirstChild("Room")
		if roomStat then
			roomStat.Value = 0
		end
		player:LoadCharacter()
	end
	resetting = false
end

function RunManager.onPlayerDied(player: Player)
	local killer = player:GetAttribute("LastKilledBy") or "The Hotel"
	local knobs = payout(player, false)
	ctx.Remotes.DeathScreen:FireClient(player, killer, DEATH_TIPS[killer] or "Keep moving.", knobs)
	ctx.HidingService.removePlayer(player)

	task.delay(0.5, function()
		if not anyoneAlive() and not escaped then
			ctx.Remotes.Notify:FireAllClients("Everyone died. The hotel rearranges itself...", Color3.fromRGB(200, 80, 80))
			task.wait(Config.RespawnDelay)
			RunManager.resetRun()
		end
	end)
end

function RunManager.win(triggerPlayer: Player)
	if escaped then
		return
	end
	escaped = true
	ctx.Remotes.Notify:FireAllClients(triggerPlayer.Name .. " pulled the lever!", Color3.fromRGB(120, 200, 255))
	for _, player in Players:GetPlayers() do
		local char = player.Character
		local humanoid = char and char:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 then
			local knobs = payout(player, true)
			ctx.Remotes.WinScreen:FireClient(player, knobs)
		end
	end
	task.delay(7, RunManager.resetRun)
end

function RunManager.getSpawnCFrame(): CFrame
	local rooms = ctx.RoomGenerator.getActiveRooms()
	local room = rooms[1]
	if room then
		return room.entryCF * CFrame.new(0, 4, -5)
	end
	return CFrame.new(0, 10, 0)
end

return RunManager
