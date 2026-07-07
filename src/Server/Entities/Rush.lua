-- Rush (ModuleScript) -> ServerScriptService/DoorsServer/Entities/Rush
--
-- The hallway sweeper. Handles BOTH variants:
--   "Rush"   - one pass, oldest room -> past the newest door, shatters lights
--   "Ambush" - faster, rebounds back and forth 2-6 extra passes, spares lights
--
-- Flow: warning cue (light flicker + client heartbeat) -> traverse the path
-- nodes of every loaded room -> kill anyone in range who isn't Hidden.
-- A player holding an equipped Crucifix banishes the entity instead.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local Rush = {}
local ctx
local rng = Random.new()
local active = false

function Rush.init(context)
	ctx = context
end

function Rush.isActive(): boolean
	return active
end

----------------------------------------------------------------
-- Visuals
----------------------------------------------------------------
local function buildModel(variant: string): Model
	local model = Instance.new("Model")
	model.Name = variant

	local core = Instance.new("Part")
	core.Name = "Core"
	core.Shape = Enum.PartType.Ball
	core.Size = Vector3.new(7, 7, 7)
	core.Color = Color3.fromRGB(15, 15, 18)
	core.Material = Enum.Material.SmoothPlastic
	core.Anchored = true
	core.CanCollide = false
	core.CastShadow = false
	core.Parent = model
	model.PrimaryPart = core

	local light = Instance.new("PointLight")
	light.Color = variant == "Ambush" and Color3.fromRGB(90, 255, 120) or Color3.fromRGB(140, 150, 180)
	light.Range = 18
	light.Brightness = 0.8
	light.Parent = core

	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(6, 6)
	gui.AlwaysOnTop = false
	local face = Instance.new("TextLabel")
	face.Size = UDim2.fromScale(1, 1)
	face.BackgroundTransparency = 1
	face.Font = Enum.Font.Nunito
	face.TextScaled = true
	face.TextColor3 = Color3.fromRGB(230, 230, 235)
	face.Text = variant == "Ambush" and "◉ ◉ ◉" or "◉   ◉"
	face.Parent = gui
	gui.Parent = core

	local smoke = Instance.new("ParticleEmitter")
	smoke.Color = ColorSequence.new(Color3.fromRGB(10, 10, 12))
	smoke.Size = NumberSequence.new(4, 8)
	smoke.Lifetime = NumberRange.new(0.4, 0.8)
	smoke.Rate = 60
	smoke.Speed = NumberRange.new(2, 5)
	smoke.Transparency = NumberSequence.new(0.3, 1)
	smoke.Parent = core

	local ambienceId = variant == "Ambush" and AudioIds.AmbushAmbience or AudioIds.RushAmbience
	local sound = SoundUtil.make(ambienceId, core, { Looped = true, Volume = 2, RollOffMaxDistance = 600 })
	if sound then
		sound:Play()
	end

	return model
end

----------------------------------------------------------------
-- Kill / banish check, run every movement step
----------------------------------------------------------------
-- Returns true if the entity was banished by a Crucifix.
local function killCheck(variant: string, conf, pos: Vector3): boolean
	for _, player in Players:GetPlayers() do
		local char = player.Character
		local hrp = char and char:FindFirstChild("HumanoidRootPart")
		local humanoid = char and char:FindFirstChildOfClass("Humanoid")
		if not hrp or not humanoid or humanoid.Health <= 0 then
			continue
		end
		if player:GetAttribute("Hidden") then
			continue
		end
		local dist = (hrp.Position - pos).Magnitude
		if dist <= Config.CrucifixRange and char:FindFirstChild("Crucifix") then
			local crucifix = char:FindFirstChild("Crucifix")
			crucifix:Destroy()
			SoundUtil.play3D(AudioIds.CrucifixBanish, hrp)
			ctx.Remotes.Notify:FireAllClients(player.Name .. "'s Crucifix banished " .. variant .. "!", Color3.fromRGB(120, 200, 255))
			return true
		end
		if dist <= conf.KillRadius then
			player:SetAttribute("LastKilledBy", variant)
			humanoid:TakeDamage(conf.Damage)
		end
	end
	return false
end

----------------------------------------------------------------
-- Movement
----------------------------------------------------------------
-- entries: array of { pos = Vector3, room = record? } traversed in order.
-- Returns false if banished mid-pass.
local function traverse(model, entries, conf, variant, breakLights): boolean
	local pos = entries[1].pos
	model:PivotTo(CFrame.new(pos))
	for i = 2, #entries do
		local entry = entries[i]
		local dir = (entry.pos - pos)
		local dist = dir.Magnitude
		if dist > 0.01 then
			dir = dir.Unit
			local travelled = 0
			while travelled < dist do
				local dt = task.wait()
				local step = math.min(conf.Speed * dt, dist - travelled)
				travelled += step
				pos += dir * step
				model:PivotTo(CFrame.new(pos))
				if killCheck(variant, conf, pos) then
					return false
				end
			end
		end
		-- shatter lights as it enters each room (Rush only)
		if breakLights and entry.room and entry.enteringRoom and entry.room.model.Parent then
			ctx.LightingService.breakRoomLights(entry.room)
		end
	end
	return true
end

----------------------------------------------------------------
-- Spawn
----------------------------------------------------------------
function Rush.spawn(variant: string)
	if active then
		return
	end
	active = true
	local conf = Config[variant]

	-- 1) Warning: flicker every loaded room, heartbeat cue on all clients
	local rooms = ctx.RoomGenerator.getActiveRooms()
	ctx.Remotes.EntityCue:FireAllClients(variant, "warning")
	ctx.LightingService.flickerRooms(rooms, conf.WarningTime)
	task.wait(conf.WarningTime)

	-- 2) Build the path: oldest room -> newest, then overshoot past the door
	local entries = {}
	for _, room in rooms do
		table.insert(entries, { pos = room.pathNodes[1], room = room, enteringRoom = true })
		table.insert(entries, { pos = room.pathNodes[2], room = room })
	end
	if #entries < 2 then
		active = false
		return
	end
	local last = entries[#entries].pos
	local prev = entries[#entries - 1].pos
	local outDir = (last - prev).Magnitude > 0.01 and (last - prev).Unit or Vector3.new(0, 0, -1)
	table.insert(entries, { pos = last + outDir * conf.DespawnOvershoot })

	-- 3) Sweep
	local model = buildModel(variant)
	model.Parent = workspace

	local passes = 1
	if variant == "Ambush" then
		passes += rng:NextInteger(conf.ReboundsMin, conf.ReboundsMax)
	end

	local banished = false
	for pass = 1, passes do
		ctx.Remotes.EntityCue:FireAllClients(variant, "attack")
		local forward = pass % 2 == 1
		local ordered = entries
		if not forward then
			ordered = {}
			for i = #entries, 1, -1 do
				table.insert(ordered, { pos = entries[i].pos })
			end
		end
		local survived = traverse(model, ordered, conf, variant, conf.BreaksLights and pass == 1)
		if not survived then
			banished = true
			break
		end
		if pass < passes then
			ctx.Remotes.EntityCue:FireAllClients(variant, "rebound")
			task.wait(rng:NextNumber(conf.ReboundPause[1], conf.ReboundPause[2]))
		end
	end

	model:Destroy()
	ctx.Remotes.EntityCue:FireAllClients(variant, banished and "banished" or "clear")
	active = false
end

return Rush
