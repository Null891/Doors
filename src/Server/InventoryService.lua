-- InventoryService (ModuleScript) -> ServerScriptService/DoorsServer/InventoryService
--
-- Per-player run inventory: keys, gold, and lockpick charges. Gold and knobs
-- are mirrored into leaderstats (created by Main) so the HUD and the player
-- list both stay in sync automatically.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local InventoryService = {}
local ctx

local data = {} -- [player] = { keys = {[doorNumber]=true}, lockpicks = n }

function InventoryService.init(context)
	ctx = context
end

function InventoryService.setupPlayer(player: Player)
	data[player] = { keys = {}, lockpicks = 0 }
end

function InventoryService.removePlayer(player: Player)
	data[player] = nil
end

-- Wipes run-scoped inventory (keys, picks). Gold is handled by RunManager
-- via takeAllGold so it can be converted to knobs first.
function InventoryService.resetRun(player: Player)
	if data[player] then
		data[player] = { keys = {}, lockpicks = 0 }
	end
end

----------------------------------------------------------------
-- Gold (stored on the leaderstats IntValue)
----------------------------------------------------------------
local function goldValue(player): IntValue?
	local stats = player:FindFirstChild("leaderstats")
	return stats and stats:FindFirstChild("Gold") :: IntValue
end

function InventoryService.addGold(player: Player, amount: number)
	local value = goldValue(player)
	if value then
		value.Value += amount
	end
end

function InventoryService.spendGold(player: Player, amount: number): boolean
	local value = goldValue(player)
	if value and value.Value >= amount then
		value.Value -= amount
		return true
	end
	return false
end

function InventoryService.takeAllGold(player: Player): number
	local value = goldValue(player)
	if not value then
		return 0
	end
	local amount = value.Value
	value.Value = 0
	return amount
end

----------------------------------------------------------------
-- Keys & lockpicks
----------------------------------------------------------------
function InventoryService.useKey(player: Player, doorNumber: number): boolean
	local inv = data[player]
	if inv and inv.keys[doorNumber] then
		inv.keys[doorNumber] = nil
		return true
	end
	return false
end

function InventoryService.addLockpick(player: Player)
	local inv = data[player]
	if inv then
		inv.lockpicks += 1
	end
end

function InventoryService.useLockpick(player: Player): boolean
	local inv = data[player]
	if inv and inv.lockpicks > 0 then
		inv.lockpicks -= 1
		ctx.Remotes.Notify:FireClient(player, "Used a lockpick (" .. inv.lockpicks .. " left)", Color3.fromRGB(212, 175, 55))
		return true
	end
	return false
end

----------------------------------------------------------------
-- World pickups (called by RoomGenerator for every new room)
----------------------------------------------------------------
function InventoryService.registerRoom(record)
	local pedestal = record.keyPedestal
	if pedestal then
		pedestal.prompt.Triggered:Connect(function(player)
			if not pedestal.key.Parent then
				return
			end
			local inv = data[player]
			if not inv then
				return
			end
			inv.keys[pedestal.doorNumber] = true
			SoundUtil.play3D(AudioIds.KeyPickup, record.model:FindFirstChild("Floor"))
			pedestal.key:Destroy()
			ctx.Remotes.Notify:FireAllClients(player.Name .. " took the key for Door " .. pedestal.doorNumber, Color3.fromRGB(212, 175, 55))
		end)
	end

	for _, pile in record.goldPiles do
		local prompt = pile:FindFirstChild("GoldPrompt")
		prompt.Triggered:Connect(function(player)
			if not pile.Parent then
				return
			end
			local amount = pile:GetAttribute("Amount") or 0
			InventoryService.addGold(player, amount)
			SoundUtil.play3D(AudioIds.GoldPickup, record.model:FindFirstChild("Floor"))
			ctx.Remotes.Notify:FireClient(player, "+" .. amount .. " gold", Color3.fromRGB(212, 175, 55))
			pile:Destroy()
		end)
	end
end

return InventoryService
