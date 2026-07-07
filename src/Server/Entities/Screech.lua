-- Screech (ModuleScript) -> ServerScriptService/DoorsServer/Entities/Screech
--
-- Hunts players sitting in DARK rooms. One roll per player per dark room
-- entered (plus a cooldown): a "psst" sounds from a fixed spot just behind
-- the player. If the client reports it on screen within the window, it
-- screams and leaves. If not: 40 damage bite.
--
-- The camera check itself happens on the client (the server can't see
-- camera orientation); the server enforces the timing window and cooldowns.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local Screech = {}
local ctx
local rng = Random.new()

local busy = {} -- [player] = { looked = bool }
local lastRollRoom = {} -- [player] = room number last rolled in
local lastAttackTime = {} -- [player] = os.clock()

local function buildModel(): Model
	local model = Instance.new("Model")
	model.Name = "Screech"
	local core = Instance.new("Part")
	core.Name = "Core"
	core.Shape = Enum.PartType.Ball
	core.Size = Vector3.new(2.4, 2.4, 2.4)
	core.Color = Color3.fromRGB(10, 10, 10)
	core.Material = Enum.Material.SmoothPlastic
	core.Anchored = true
	core.CanCollide = false
	core.CastShadow = false
	core.Parent = model
	model.PrimaryPart = core

	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(2.5, 2.5)
	local face = Instance.new("TextLabel")
	face.Size = UDim2.fromScale(1, 1)
	face.BackgroundTransparency = 1
	face.Font = Enum.Font.Nunito
	face.TextScaled = true
	face.TextColor3 = Color3.fromRGB(240, 240, 240)
	face.Text = "◉‿◉"
	face.Parent = gui
	gui.Parent = core
	return model
end

local function attack(player: Player)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart")
	local humanoid = char and char:FindFirstChildOfClass("Humanoid")
	if not hrp or not humanoid or humanoid.Health <= 0 or busy[player] then
		return
	end

	busy[player] = { looked = false }
	lastAttackTime[player] = os.clock()

	-- fixed WORLD offset behind the player's current facing, so turning
	-- the camera around reveals it
	local lateral = rng:NextNumber(-3, 3)
	local offset = -hrp.CFrame.LookVector * 6 + hrp.CFrame.RightVector * lateral + Vector3.new(0, 2.5, 0)

	local model = buildModel()
	model:PivotTo(CFrame.new(hrp.Position + offset))
	model.Parent = workspace

	SoundUtil.play3D(AudioIds.ScreechPsst, model.PrimaryPart, { Volume = 1.5 })
	ctx.Remotes.EntityCue:FireClient(player, "Screech", "spawn", model)

	task.spawn(function()
		local deadline = os.clock() + Config.Screech.LookWindow
		while os.clock() < deadline do
			task.wait(0.05)
			local state = busy[player]
			if not state then
				break
			end
			-- follow the player's position (same world offset)
			if hrp.Parent and model.Parent then
				model:PivotTo(CFrame.new(hrp.Position + offset))
			end
			if state.looked then
				-- spotted in time: scream and vanish, no damage
				SoundUtil.play3D(AudioIds.ScreechScream, model.PrimaryPart, { Volume = 2 })
				ctx.Remotes.EntityCue:FireClient(player, "Screech", "scream")
				task.wait(0.4)
				break
			end
			if humanoid.Health <= 0 or player:GetAttribute("Hidden") or not player.Parent then
				break -- hid or died mid-window: it loses interest
			end
		end

		local state = busy[player]
		if state and not state.looked and humanoid.Health > 0 and not player:GetAttribute("Hidden") and player.Parent then
			player:SetAttribute("LastKilledBy", "Screech")
			humanoid:TakeDamage(Config.Screech.Damage)
			SoundUtil.play3D(AudioIds.ScreechBite, hrp, { Volume = 2 })
			ctx.Remotes.EntityCue:FireClient(player, "Screech", "bite")
		end
		busy[player] = nil
		model:Destroy()
	end)
end

function Screech.init(context)
	ctx = context
	task.spawn(function()
		while true do
			task.wait(1.5)
			for _, player in Players:GetPlayers() do
				local char = player.Character
				local hrp = char and char:FindFirstChild("HumanoidRootPart")
				local humanoid = char and char:FindFirstChildOfClass("Humanoid")
				if not hrp or not humanoid or humanoid.Health <= 0 then
					continue
				end
				if busy[player] or player:GetAttribute("Hidden") then
					continue
				end
				local room = ctx.RoomGenerator.getRoomOfPosition(hrp.Position)
				if not room or room.number < 1 or room.isShop or room.isElevator then
					continue
				end
				if not ctx.LightingService.isRoomDark(room) then
					continue
				end
				-- one roll per dark room entered, plus a hard cooldown
				if lastRollRoom[player] == room.number then
					continue
				end
				lastRollRoom[player] = room.number
				if os.clock() - (lastAttackTime[player] or 0) < Config.Screech.Cooldown then
					continue
				end
				if rng:NextNumber() < Config.Screech.Chance then
					attack(player)
				end
			end
		end
	end)
end

-- Client says the entity is on screen. Trusted for this cue.
function Screech.onReport(player: Player)
	local state = busy[player]
	if state then
		state.looked = true
	end
end

function Screech.forceAttack()
	for _, player in Players:GetPlayers() do
		local char = player.Character
		if char and char:FindFirstChild("HumanoidRootPart") and not busy[player] then
			attack(player)
			return
		end
	end
end

function Screech.removePlayer(player: Player)
	busy[player] = nil
	lastRollRoom[player] = nil
	lastAttackTime[player] = nil
end

return Screech
