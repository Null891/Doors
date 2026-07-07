-- ClientMain (LocalScript) -> StarterPlayerScripts/DoorsClient/ClientMain
--
-- Everything presentation-side: HUD, camera shake, heartbeat/ambience,
-- hiding letterbox + FOV, death/win screens, and the two camera checks the
-- server can't do itself (Screech "did you look at it", Eyes "are you
-- looking at it").

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local SoundService = game:GetService("SoundService")

local player = Players.LocalPlayer

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AudioIds = require(Shared.AudioIds)
local SoundUtil = require(Shared.SoundUtil)

local UIBuilder = require(script.Parent.UIBuilder)
local CameraShake = require(script.Parent.CameraShake)

local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local RoomChanged = Remotes:WaitForChild("RoomChanged")
local Notify = Remotes:WaitForChild("Notify")
local EntityCue = Remotes:WaitForChild("EntityCue")
local HideState = Remotes:WaitForChild("HideState")
local DeathScreen = Remotes:WaitForChild("DeathScreen")
local WinScreen = Remotes:WaitForChild("WinScreen")
local EntityReport = Remotes:WaitForChild("EntityReport")

local UI = UIBuilder.build(player)
CameraShake.start()

----------------------------------------------------------------
-- Persistent sounds
----------------------------------------------------------------
local ambience = SoundUtil.make(AudioIds.AmbienceLoop, SoundService, { Looped = true, Volume = 0.35 })
if ambience then
	ambience:Play()
end

local heartbeat = SoundUtil.make(AudioIds.Heartbeat, SoundService, { Looped = true, Volume = 0.8 })
local function setHeartbeat(on: boolean)
	if heartbeat then
		if on and not heartbeat.IsPlaying then
			heartbeat:Play()
		elseif not on then
			heartbeat:Stop()
		end
	end
end

----------------------------------------------------------------
-- Leaderstat -> HUD binding
----------------------------------------------------------------
task.spawn(function()
	local stats = player:WaitForChild("leaderstats")
	local gold = stats:WaitForChild("Gold") :: IntValue
	local knobs = stats:WaitForChild("Knobs") :: IntValue
	UI.setGold(gold.Value)
	UI.setKnobs(knobs.Value)
	gold.Changed:Connect(UI.setGold)
	knobs.Changed:Connect(UI.setKnobs)
end)

----------------------------------------------------------------
-- Simple remote handlers
----------------------------------------------------------------
RoomChanged.OnClientEvent:Connect(UI.setRoom)

Notify.OnClientEvent:Connect(function(text, color)
	UI.toast(text, color)
end)

local function tweenFOV(fov: number)
	local camera = workspace.CurrentCamera
	if camera then
		TweenService:Create(camera, TweenInfo.new(0.4), { FieldOfView = fov }):Play()
	end
end

HideState.OnClientEvent:Connect(function(state)
	if state == "in" then
		UI.setHidden(true)
		tweenFOV(55)
	elseif state == "out" then
		UI.setHidden(false)
		tweenFOV(70)
	elseif state == "warn" then
		UI.showGetOut()
		SoundUtil.play2D(AudioIds.HideWhisper, { Volume = 1.5 })
		CameraShake.impulse(0.8)
	end
end)

DeathScreen.OnClientEvent:Connect(function(killer, tip, knobs)
	setHeartbeat(false)
	UI.setHidden(false)
	SoundUtil.play2D(AudioIds.Jumpscare, { Volume = 1.5 })
	CameraShake.impulse(2.5)
	UI.showDeath(killer, tip, knobs)
end)

WinScreen.OnClientEvent:Connect(function(knobs)
	setHeartbeat(false)
	SoundUtil.play2D(AudioIds.WinMusic, { Volume = 1 })
	UI.showWin(knobs)
	task.delay(6.5, UI.hideOverlay)
end)

player.CharacterAdded:Connect(function()
	UI.hideOverlay()
	UI.setHidden(false)
	tweenFOV(70)
end)

----------------------------------------------------------------
-- Camera checks for Screech and Eyes
----------------------------------------------------------------
local function onScreen(worldPos: Vector3, maxDist: number): boolean
	local camera = workspace.CurrentCamera
	if not camera then
		return false
	end
	if (camera.CFrame.Position - worldPos).Magnitude > maxDist then
		return false
	end
	local _, visible = camera:WorldToViewportPoint(worldPos)
	return visible
end

-- Screech: when it spawns for us, watch until we spot it (or it resolves)
local activeScreech: Model? = nil

local function watchScreech(model: Model)
	activeScreech = model
	task.spawn(function()
		while activeScreech == model and model.Parent do
			local core = model.PrimaryPart
			if core and onScreen(core.Position, 40) then
				EntityReport:FireServer("Screech")
				break
			end
			task.wait(0.05)
		end
	end)
end

-- Eyes: report looking-state changes while any Eyes model exists
local eyesModels: { Model } = {}
local eyesLooking = false

task.spawn(function()
	while true do
		task.wait(0.15)
		local looking = false
		for i = #eyesModels, 1, -1 do
			local model = eyesModels[i]
			if not model.Parent then
				table.remove(eyesModels, i)
			elseif model.PrimaryPart and onScreen(model.PrimaryPart.Position, 90) then
				looking = true
			end
		end
		if looking ~= eyesLooking then
			eyesLooking = looking
			EntityReport:FireServer("Eyes", looking)
		end
	end
end)

----------------------------------------------------------------
-- Entity cues
----------------------------------------------------------------
EntityCue.OnClientEvent:Connect(function(entity, phase, data)
	if entity == "Rush" or entity == "Ambush" then
		if phase == "warning" then
			setHeartbeat(true)
			CameraShake.impulse(0.5)
			UI.toast(entity == "Ambush" and "Something is very wrong..." or "The lights...", Color3.fromRGB(200, 80, 80))
		elseif phase == "attack" then
			CameraShake.impulse(1.8)
		elseif phase == "rebound" then
			UI.toast("It's coming back!", Color3.fromRGB(200, 80, 80))
		elseif phase == "clear" or phase == "banished" then
			setHeartbeat(false)
			if phase == "banished" then
				UI.toast("It's gone.", Color3.fromRGB(120, 200, 255))
			end
		end
	elseif entity == "Screech" then
		if phase == "spawn" and typeof(data) == "Instance" then
			SoundUtil.play2D(AudioIds.ScreechPsst, { Volume = 1 })
			watchScreech(data)
		elseif phase == "scream" then
			CameraShake.impulse(1.2)
			activeScreech = nil
		elseif phase == "bite" then
			UI.flash(Color3.fromRGB(255, 0, 0))
			CameraShake.impulse(2)
			activeScreech = nil
		end
	elseif entity == "Eyes" then
		if phase == "spawn" and typeof(data) == "Instance" then
			table.insert(eyesModels, data)
			UI.toast("Something watches from the next room...", Color3.fromRGB(160, 70, 255))
		elseif phase == "clear" and typeof(data) == "Instance" then
			local index = table.find(eyesModels, data)
			if index then
				table.remove(eyesModels, index)
			end
		elseif phase == "damage" then
			UI.flash(Color3.fromRGB(140, 40, 220))
			CameraShake.impulse(0.7)
		end
	end
end)
