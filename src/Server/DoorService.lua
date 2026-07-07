-- DoorService (ModuleScript) -> ServerScriptService/DoorsServer/DoorService
--
-- Handles every exit-door interaction: distance validation, locks, keys,
-- lockpicks, the actual open (which triggers generation of the next room),
-- and the Guiding Light hint that makes the key glow when a group is stuck.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local DoorService = {}
local ctx

function DoorService.init(context)
	ctx = context
end

local function playerNear(player: Player, part: BasePart, maxDist: number): boolean
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart")
	local humanoid = char and char:FindFirstChildOfClass("Humanoid")
	if not hrp or not humanoid or humanoid.Health <= 0 then
		return false
	end
	return (hrp.Position - part.Position).Magnitude <= maxDist
end

local function unlockDoor(record, doorModel)
	doorModel:SetAttribute("Locked", false)
	record.locked = false
	local padlock = doorModel:FindFirstChild("Padlock")
	if padlock then
		padlock:Destroy()
	end
	SoundUtil.play3D(AudioIds.DoorUnlock, doorModel.PrimaryPart)
end

local function openDoor(player, record)
	local doorModel = record.exitDoor
	if doorModel:GetAttribute("Opened") then
		return
	end
	doorModel:SetAttribute("Opened", true)

	local doorPart = doorModel.PrimaryPart
	local prompt = doorPart:FindFirstChild("DoorPrompt")
	if prompt then
		prompt.Enabled = false
	end

	ctx.RoomGenerator.swingDoor(doorPart, true)
	SoundUtil.play3D(AudioIds.DoorOpen, doorPart)

	local newRoom = ctx.RoomGenerator.generateNext()
	ctx.Remotes.RoomChanged:FireAllClients(newRoom.number)
	ctx.RunManager.onDoorOpened(newRoom)
	ctx.EntityService.onDoorOpened(newRoom, player)
end

local function tryOpen(player, record)
	local doorModel = record.exitDoor
	local doorPart = doorModel.PrimaryPart
	if doorModel:GetAttribute("Opened") then
		return
	end
	if not playerNear(player, doorPart, Config.DoorwayWidth + 8) then
		return -- server-side re-validation of the prompt distance
	end

	if doorModel:GetAttribute("Locked") then
		local number = doorModel:GetAttribute("Number")
		if ctx.InventoryService.useKey(player, number) then
			unlockDoor(record, doorModel)
			ctx.Remotes.Notify:FireAllClients(player.Name .. " unlocked Door " .. number, Color3.fromRGB(212, 175, 55))
		elseif ctx.InventoryService.useLockpick(player) then
			unlockDoor(record, doorModel)
			ctx.Remotes.Notify:FireAllClients(player.Name .. " picked the lock on Door " .. number, Color3.fromRGB(212, 175, 55))
		else
			SoundUtil.play3D(AudioIds.DoorLocked, doorPart)
			ctx.Remotes.Notify:FireClient(player, "Locked. Find the key in this room.", Color3.fromRGB(200, 80, 80))
			return
		end
	end

	openDoor(player, record)
end

-- Guiding Light: if the room's exit is still locked after a while and the
-- key hasn't been taken, wrap the key in a soft blue glow.
local function startGuidingLight(record)
	task.delay(Config.GuidingLightDelay, function()
		local pedestal = record.keyPedestal
		if not record.locked or not pedestal or not pedestal.key.Parent then
			return
		end
		local highlight = Instance.new("Highlight")
		highlight.FillColor = Color3.fromRGB(120, 200, 255)
		highlight.FillTransparency = 0.4
		highlight.OutlineColor = Color3.fromRGB(160, 220, 255)
		highlight.Parent = pedestal.key
		local light = Instance.new("PointLight")
		light.Color = Color3.fromRGB(120, 200, 255)
		light.Range = 12
		light.Brightness = 2
		light.Parent = pedestal.key
	end)
end

function DoorService.registerRoom(record)
	local doorModel = record.exitDoor
	if not doorModel then
		return -- elevator room has no exit
	end
	local prompt = doorModel.PrimaryPart:FindFirstChild("DoorPrompt")
	prompt.Triggered:Connect(function(player)
		tryOpen(player, record)
	end)
	if record.locked then
		startGuidingLight(record)
	end
end

return DoorService
