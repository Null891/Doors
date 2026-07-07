-- LightingService (ModuleScript) -> ServerScriptService/DoorsServer/LightingService
--
-- Owns the horror atmosphere (fog, ambient), room light state (on/off/dark),
-- the flicker used as an entity warning, and lamp shattering when Rush
-- passes through. Screech asks isRoomDark() to decide where it can hunt.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local LightingService = {}
local ctx
local rng = Random.new()

function LightingService.init(context)
	ctx = context

	Lighting.ClockTime = 0
	Lighting.Brightness = 0.6
	Lighting.Ambient = Color3.fromRGB(22, 20, 18)
	Lighting.OutdoorAmbient = Color3.fromRGB(10, 10, 12)
	Lighting.GlobalShadows = true
	Lighting.FogColor = Color3.fromRGB(8, 6, 6)
	Lighting.FogStart = 40
	Lighting.FogEnd = 220

	if not Lighting:FindFirstChildOfClass("Atmosphere") then
		local atmosphere = Instance.new("Atmosphere")
		atmosphere.Density = 0.35
		atmosphere.Color = Color3.fromRGB(60, 50, 45)
		atmosphere.Decay = Color3.fromRGB(20, 15, 15)
		atmosphere.Parent = Lighting
	end
end

----------------------------------------------------------------
-- Lamp state helpers
----------------------------------------------------------------
local function setLamp(lamp: BasePart, on: boolean)
	if lamp:GetAttribute("Broken") then
		on = false
	end
	lamp.Material = on and Enum.Material.Neon or Enum.Material.Glass
	local light = lamp:FindFirstChildOfClass("PointLight")
	if light then
		light.Enabled = on
	end
end

function LightingService.setRoomLights(record, on: boolean)
	record.lightsOn = on
	for _, lamp in record.lights do
		setLamp(lamp, on)
	end
end

function LightingService.isRoomDark(record): boolean
	if not record.lightsOn then
		return true
	end
	for _, lamp in record.lights do
		if not lamp:GetAttribute("Broken") then
			return false -- at least one working lamp is on
		end
	end
	return true
end

function LightingService.shatterLamp(lamp: BasePart)
	if lamp:GetAttribute("Broken") then
		return
	end
	lamp:SetAttribute("Broken", true)
	setLamp(lamp, false)
	lamp.Color = Color3.fromRGB(80, 75, 70)
	SoundUtil.play3D(AudioIds.LightShatter, lamp)
end

function LightingService.breakRoomLights(record)
	for _, lamp in record.lights do
		LightingService.shatterLamp(lamp)
	end
	record.lightsOn = false
end

----------------------------------------------------------------
-- Flicker (entity warning cue)
----------------------------------------------------------------
-- Rapidly strobes every working lamp in the given rooms for `duration`
-- seconds, then restores each room to its previous state. Runs async.
function LightingService.flickerRooms(records, duration: number)
	task.spawn(function()
		local restore = {}
		for _, record in records do
			restore[record] = record.lightsOn
		end
		local elapsed = 0
		while elapsed < duration do
			local step = rng:NextNumber(0.05, 0.15)
			for _, record in records do
				for _, lamp in record.lights do
					if not lamp:GetAttribute("Broken") then
						setLamp(lamp, rng:NextNumber() < 0.5)
					end
				end
			end
			task.wait(step)
			elapsed += step
		end
		for record, wasOn in restore do
			if record.model.Parent then
				LightingService.setRoomLights(record, wasOn)
			end
		end
	end)
end

----------------------------------------------------------------
-- Per-room wiring
----------------------------------------------------------------
function LightingService.registerRoom(record)
	record.lightsOn = not record.dark

	local switch = record.switch
	if not switch then
		return
	end
	local prompt = switch:FindFirstChild("SwitchPrompt")
	prompt.Triggered:Connect(function(player)
		SoundUtil.play3D(AudioIds.LightSwitch, switch)
		local anyWorking = false
		for _, lamp in record.lights do
			if not lamp:GetAttribute("Broken") then
				anyWorking = true
				break
			end
		end
		if not anyWorking then
			ctx.Remotes.Notify:FireClient(player, "The bulbs are shattered.", Color3.fromRGB(200, 80, 80))
			return
		end
		LightingService.setRoomLights(record, not record.lightsOn)
	end)
end

return LightingService
