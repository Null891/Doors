-- HidingService (ModuleScript) -> ServerScriptService/DoorsServer/HidingService
--
-- Closet hiding: teleports the player inside, tracks occupancy, and plays
-- the "Hide" entity role — camp a closet too long and you get a GET OUT
-- warning, then you're thrown out and damaged.
--
-- Entities check `player:GetAttribute("Hidden")` to decide whether you're
-- a valid target.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local HidingService = {}
local ctx

-- [player] = { closet = closetRecord, token = number }
local hiddenState = {}
local tokenCounter = 0

function HidingService.init(context)
	ctx = context
end

local function setHidden(player: Player, hidden: boolean)
	player:SetAttribute("Hidden", hidden)
	local char = player.Character
	if char then
		char:SetAttribute("Hidden", hidden)
	end
end

local function exitCloset(player: Player, forced: boolean)
	local state = hiddenState[player]
	if not state then
		return
	end
	hiddenState[player] = nil
	local closet = state.closet
	closet.occupant = nil
	setHidden(player, false)

	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart")
	local humanoid = char and char:FindFirstChildOfClass("Humanoid")

	if closet.door.Parent then
		ctx.RoomGenerator.swingDoor(closet.door, true)
		SoundUtil.play3D(AudioIds.ClosetOut, closet.door)
		task.delay(0.6, function()
			if closet.door.Parent and not closet.occupant then
				ctx.RoomGenerator.swingDoor(closet.door, false)
			end
		end)
	end

	if hrp then
		hrp.Anchored = false
		-- step out in front of the closet
		hrp.CFrame = closet.hidePoint.CFrame * CFrame.new(0, 0, -3.5)
	end

	ctx.Remotes.HideState:FireClient(player, "out")

	if forced and humanoid and humanoid.Health > 0 then
		player:SetAttribute("LastKilledBy", "Hide")
		humanoid:TakeDamage(Config.ForceOutDamage)
		ctx.Remotes.Notify:FireClient(player, "Something forced you out!", Color3.fromRGB(200, 80, 80))
	end
end

local function enterCloset(player: Player, closet)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart")
	local humanoid = char and char:FindFirstChildOfClass("Humanoid")
	if not hrp or not humanoid or humanoid.Health <= 0 or hiddenState[player] then
		return
	end
	if (hrp.Position - closet.door.Position).Magnitude > 12 then
		return
	end

	closet.occupant = player
	tokenCounter += 1
	local token = tokenCounter
	hiddenState[player] = { closet = closet, token = token }
	setHidden(player, true)

	ctx.RoomGenerator.swingDoor(closet.door, true)
	SoundUtil.play3D(AudioIds.ClosetIn, closet.door)

	hrp.Anchored = true
	hrp.CFrame = CFrame.lookAt(closet.hidePoint.Position, closet.hidePoint.Position + closet.hidePoint.CFrame.LookVector)

	task.delay(0.35, function()
		if closet.door.Parent and closet.occupant == player then
			ctx.RoomGenerator.swingDoor(closet.door, false)
		end
	end)

	ctx.Remotes.HideState:FireClient(player, "in")

	-- Hide (the entity): warn, then throw the player out
	task.delay(Config.MaxHideTime, function()
		local state = hiddenState[player]
		if not state or state.token ~= token then
			return
		end
		ctx.Remotes.HideState:FireClient(player, "warn")
		SoundUtil.play3D(AudioIds.HideWhisper, closet.door)
		task.delay(Config.GetOutGrace, function()
			local current = hiddenState[player]
			if current and current.token == token then
				exitCloset(player, true)
			end
		end)
	end)

	-- safety: free the closet if the character dies while inside
	humanoid.Died:Once(function()
		local state = hiddenState[player]
		if state and state.token == token then
			hiddenState[player] = nil
			closet.occupant = nil
			setHidden(player, false)
			if hrp.Parent then
				hrp.Anchored = false
			end
		end
	end)
end

function HidingService.registerRoom(record)
	for _, closet in record.closets do
		closet.prompt.Triggered:Connect(function(player)
			if closet.occupant == player then
				exitCloset(player, false)
			elseif closet.occupant ~= nil then
				ctx.Remotes.Notify:FireClient(player, "Occupied.", Color3.fromRGB(200, 80, 80))
			else
				enterCloset(player, closet)
			end
		end)
	end
end

-- Used when a room is culled or the run resets: everyone out, no damage.
function HidingService.forceExitAll(record)
	for _, closet in record.closets do
		if closet.occupant then
			exitCloset(closet.occupant, false)
		end
	end
end

function HidingService.removePlayer(player: Player)
	local state = hiddenState[player]
	if state then
		state.closet.occupant = nil
		hiddenState[player] = nil
	end
end

return HidingService
