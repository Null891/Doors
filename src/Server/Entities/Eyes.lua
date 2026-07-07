-- Eyes (ModuleScript) -> ServerScriptService/DoorsServer/Entities/Eyes
--
-- A glowing purple cluster that parks itself in the middle of a room.
-- Looking at it hurts (tick damage); look away or at the floor to pass.
-- The client reports whether it's on screen (EntityReport); the server
-- validates that the player is actually inside the room and applies damage.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local Eyes = {}
local ctx

local active = {} -- [roomRecord] = { model, looking = {[player]=bool}, alive = true }

local function buildModel(): Model
	local model = Instance.new("Model")
	model.Name = "Eyes"

	local core = Instance.new("Part")
	core.Name = "Core"
	core.Shape = Enum.PartType.Ball
	core.Size = Vector3.new(5, 5, 5)
	core.Color = Color3.fromRGB(120, 40, 200)
	core.Material = Enum.Material.Neon
	core.Transparency = 0.15
	core.Anchored = true
	core.CanCollide = false
	core.CastShadow = false
	core.Parent = model
	model.PrimaryPart = core

	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(160, 70, 255)
	light.Range = 22
	light.Brightness = 1.6
	light.Parent = core

	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(5, 5)
	local face = Instance.new("TextLabel")
	face.Size = UDim2.fromScale(1, 1)
	face.BackgroundTransparency = 1
	face.Font = Enum.Font.Nunito
	face.TextScaled = true
	face.TextColor3 = Color3.fromRGB(250, 240, 255)
	face.Text = "◉ ◉\n◉ ◉ ◉"
	face.Parent = gui
	gui.Parent = core
	return model
end

local function inBounds(pos: Vector3, record): boolean
	return pos.X > record.boundsMin.X and pos.X < record.boundsMax.X
		and pos.Z > record.boundsMin.Z and pos.Z < record.boundsMax.Z
		and pos.Y > record.boundsMin.Y and pos.Y < record.boundsMax.Y
end

function Eyes.init(context)
	ctx = context
end

function Eyes.spawn(record)
	if not record or active[record] or record.isShop or record.isElevator or record.number < 1 then
		return
	end

	local model = buildModel()
	local center = record.entryCF * CFrame.new(0, 8, -record.length / 2)
	model:PivotTo(CFrame.new(center.Position))
	model.Parent = record.model -- dies with the room automatically

	local state = { model = model, looking = {}, alive = true }
	active[record] = state

	SoundUtil.make(AudioIds.EyesAmbience, model.PrimaryPart, { Looped = true, Volume = 1, RollOffMaxDistance = 120 })
	local ambience = model.PrimaryPart:FindFirstChildOfClass("Sound")
	if ambience then
		ambience:Play()
	end
	ctx.Remotes.EntityCue:FireAllClients("Eyes", "spawn", model)

	-- bob gently + damage ticks
	task.spawn(function()
		local t = 0
		local basePos = center.Position
		local nextTick = 0
		while state.alive and model.Parent do
			local dt = task.wait(0.05)
			t += dt
			model:PivotTo(CFrame.new(basePos + Vector3.new(0, math.sin(t * 2) * 0.6, 0)))

			nextTick -= dt
			if nextTick <= 0 then
				nextTick = Config.Eyes.TickRate
				for player, isLooking in state.looking do
					if not isLooking or not player.Parent then
						continue
					end
					local char = player.Character
					local hrp = char and char:FindFirstChild("HumanoidRootPart")
					local humanoid = char and char:FindFirstChildOfClass("Humanoid")
					if hrp and humanoid and humanoid.Health > 0
						and not player:GetAttribute("Hidden")
						and inBounds(hrp.Position, record) then
						player:SetAttribute("LastKilledBy", "Eyes")
						humanoid:TakeDamage(Config.Eyes.DamagePerTick)
						ctx.Remotes.EntityCue:FireClient(player, "Eyes", "damage")
					end
				end
			end
		end
	end)
end

function Eyes.despawn(record)
	local state = active[record]
	if not state then
		return
	end
	state.alive = false
	active[record] = nil
	ctx.Remotes.EntityCue:FireAllClients("Eyes", "clear", state.model)
	if state.model.Parent then
		state.model:Destroy()
	end
end

function Eyes.onRoomCulled(record)
	Eyes.despawn(record)
end

function Eyes.despawnAll()
	for record in active do
		Eyes.despawn(record)
	end
end

-- Client reports whether any Eyes is on its screen right now.
function Eyes.onReport(player: Player, looking: boolean)
	for _, state in active do
		state.looking[player] = looking
	end
end

return Eyes
