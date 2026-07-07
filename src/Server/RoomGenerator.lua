-- RoomGenerator (ModuleScript) -> ServerScriptService/DoorsServer/RoomGenerator
--
-- Builds every room procedurally out of Parts (no assets needed), keeps the
-- last N rooms loaded, culls old ones (with a Void-style straggler teleport),
-- and hands each new room record to the other services so they can wire up
-- prompts and behavior.
--
-- Coordinate convention: every room is built relative to a "base" CFrame that
-- sits at the entry doorway's floor center with LookVector pointing INTO the
-- room. lcf(base, x, y, z, yaw) means x studs right, y up, z deep into the
-- room, then an optional yaw in degrees.

local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local Templates = require(Shared.RoomTemplates)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local RoomGenerator = {}

local ctx -- injected by Main: { DoorService, HidingService, LightingService, EntityService, InventoryService, ItemService, RunManager, Remotes }
local rng = Random.new()
local rooms = {} -- oldest -> newest room records
local roomsFolder

----------------------------------------------------------------
-- Style
----------------------------------------------------------------
local STYLE = {
	Wall = { Color = Color3.fromRGB(92, 70, 56), Material = Enum.Material.WoodPlanks },
	Floor = { Color = Color3.fromRGB(56, 42, 34), Material = Enum.Material.WoodPlanks },
	Ceiling = { Color = Color3.fromRGB(44, 36, 32), Material = Enum.Material.Wood },
	Door = { Color = Color3.fromRGB(70, 46, 34), Material = Enum.Material.Wood },
	Frame = { Color = Color3.fromRGB(38, 26, 20), Material = Enum.Material.Wood },
	Closet = { Color = Color3.fromRGB(52, 34, 26), Material = Enum.Material.Wood },
	Metal = { Color = Color3.fromRGB(120, 124, 130), Material = Enum.Material.DiamondPlate },
	Gold = { Color = Color3.fromRGB(212, 175, 55), Material = Enum.Material.Metal },
}

----------------------------------------------------------------
-- Small helpers
----------------------------------------------------------------
local function lcf(base: CFrame, x: number, y: number, z: number, yaw: number?): CFrame
	return base * CFrame.new(x, y, -z) * CFrame.Angles(0, math.rad(yaw or 0), 0)
end

local function newPart(parent: Instance, name: string, size: Vector3, cf: CFrame, style, props): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = cf
	part.Anchored = true
	part.Color = style.Color
	part.Material = style.Material
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	if props then
		for key, value in props do
			(part :: any)[key] = value
		end
	end
	part.Parent = parent
	return part
end

local function newPrompt(parent: Instance, actionText: string, objectText: string, distance: number?): ProximityPrompt
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = actionText
	prompt.ObjectText = objectText
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = distance or 9
	prompt.RequiresLineOfSight = false
	prompt.Parent = parent
	return prompt
end

-- Swings a door part around its left-edge hinge. Used for room doors and
-- closet doors. The closed CFrame is remembered as an attribute the first
-- time so the door can always be re-closed exactly.
function RoomGenerator.swingDoor(door: BasePart, open: boolean)
	local closed = door:GetAttribute("ClosedCF") :: CFrame?
	if not closed then
		closed = door.CFrame
		door:SetAttribute("ClosedCF", closed)
	end
	local width = door.Size.X
	local hinge = closed * CFrame.new(-width / 2, 0, 0)
	local target = if open
		then hinge * CFrame.Angles(0, math.rad(115), 0) * CFrame.new(width / 2, 0, 0)
		else closed
	door.CanCollide = not open
	TweenService:Create(door, TweenInfo.new(0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		CFrame = target,
	}):Play()
end

----------------------------------------------------------------
-- Walls (with optional doorway gaps)
----------------------------------------------------------------
-- wallCF: center-bottom of the wall, part-X axis running along its length.
-- gap = { offset = distance of gap center from wall center along part-X }
local function buildWall(model, name, wallCF, length, height, thickness, gap)
	if not gap then
		newPart(model, name, Vector3.new(length, height, thickness), wallCF * CFrame.new(0, height / 2, 0), STYLE.Wall)
		return
	end
	local gw, gh = Config.DoorwayWidth, Config.DoorwayHeight
	local leftLen = (gap.offset - gw / 2) + length / 2
	local rightLen = length / 2 - (gap.offset + gw / 2)
	if leftLen > 0.05 then
		local cx = (-length / 2 + (gap.offset - gw / 2)) / 2
		newPart(model, name .. "_L", Vector3.new(leftLen, height, thickness), wallCF * CFrame.new(cx, height / 2, 0), STYLE.Wall)
	end
	if rightLen > 0.05 then
		local cx = ((gap.offset + gw / 2) + length / 2) / 2
		newPart(model, name .. "_R", Vector3.new(rightLen, height, thickness), wallCF * CFrame.new(cx, height / 2, 0), STYLE.Wall)
	end
	newPart(model, name .. "_Top", Vector3.new(gw, height - gh, thickness), wallCF * CFrame.new(gap.offset, gh + (height - gh) / 2, 0), STYLE.Wall)
end

----------------------------------------------------------------
-- Doors
----------------------------------------------------------------
-- doorwayCF: floor center of the doorway, LookVector pointing OUT of the room
-- (into the next room). Returns the door model.
local function makeDoor(parent, doorwayCF, number, locked)
	local gw, gh = Config.DoorwayWidth, Config.DoorwayHeight
	local model = Instance.new("Model")
	model.Name = "Door_" .. number
	model:SetAttribute("Number", number)
	model:SetAttribute("Locked", locked)
	model:SetAttribute("Opened", false)

	-- Frame: two jambs and a header, deep enough to bridge the seam between rooms
	local depth = 2.2
	newPart(model, "JambL", Vector3.new(0.8, gh, depth), doorwayCF * CFrame.new(-(gw / 2 + 0.4), gh / 2, 0), STYLE.Frame)
	newPart(model, "JambR", Vector3.new(0.8, gh, depth), doorwayCF * CFrame.new(gw / 2 + 0.4, gh / 2, 0), STYLE.Frame)
	newPart(model, "Header", Vector3.new(gw + 1.6, 1, depth), doorwayCF * CFrame.new(0, gh + 0.5, 0), STYLE.Frame)

	local door = newPart(model, "Door", Vector3.new(gw - 0.4, gh - 0.4, 0.6), doorwayCF * CFrame.new(0, (gh - 0.4) / 2, 0), STYLE.Door)
	door:SetAttribute("ClosedCF", door.CFrame)
	model.PrimaryPart = door

	newPart(model, "Knob", Vector3.new(0.5, 0.5, 0.9), doorwayCF * CFrame.new(gw / 2 - 1.2, 4.6, 0), STYLE.Gold, { Shape = Enum.PartType.Ball })

	-- Room number plate (players approach the door's Back face)
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Back
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 40
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 0.32)
	label.Position = UDim2.fromScale(0, 0.08)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.Antique
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(215, 195, 160)
	label.Text = tostring(number)
	label.Parent = gui
	gui.Parent = door

	if locked then
		local padlock = newPart(model, "Padlock", Vector3.new(1.2, 1.6, 0.6), doorwayCF * CFrame.new(gw / 2 - 1.2, 3.2, -0.5), STYLE.Gold)
		padlock.Name = "Padlock"
	end

	local prompt = newPrompt(door, "Open", "Door " .. number, 10)
	prompt.Name = "DoorPrompt"

	model.Parent = parent
	return model
end

----------------------------------------------------------------
-- Closets
----------------------------------------------------------------
-- closetCF: floor center of the closet, LookVector pointing INTO the room.
local function makeCloset(parent, closetCF, index)
	local model = Instance.new("Model")
	model.Name = "Closet_" .. index

	newPart(model, "Back", Vector3.new(4.4, 9, 0.4), closetCF * CFrame.new(0, 4.5, 1.6), STYLE.Closet)
	newPart(model, "SideL", Vector3.new(0.4, 9, 3.2), closetCF * CFrame.new(-2.2, 4.5, 0), STYLE.Closet)
	newPart(model, "SideR", Vector3.new(0.4, 9, 3.2), closetCF * CFrame.new(2.2, 4.5, 0), STYLE.Closet)
	newPart(model, "Top", Vector3.new(4.8, 0.4, 3.6), closetCF * CFrame.new(0, 9.2, 0), STYLE.Closet)

	local door = newPart(model, "ClosetDoor", Vector3.new(4, 8.6, 0.35), closetCF * CFrame.new(0, 4.3, -1.7), STYLE.Door)
	door:SetAttribute("ClosedCF", door.CFrame)

	-- Slats so hiding players can "see" out a little
	newPart(model, "Slat", Vector3.new(2.6, 0.15, 0.1), closetCF * CFrame.new(0, 5.6, -1.9), STYLE.Frame, { CanCollide = false })
	newPart(model, "Slat2", Vector3.new(2.6, 0.15, 0.1), closetCF * CFrame.new(0, 5.0, -1.9), STYLE.Frame, { CanCollide = false })

	local hidePoint = newPart(model, "HidePoint", Vector3.new(1, 1, 2), closetCF * CFrame.new(0, 3, 0.1), STYLE.Closet, {
		Transparency = 1,
		CanCollide = false,
	})

	local prompt = newPrompt(door, "Hide", "Closet", 8)
	prompt.Name = "HidePrompt"

	model.PrimaryPart = door
	model.Parent = parent
	return { model = model, door = door, hidePoint = hidePoint, prompt = prompt, occupant = nil }
end

----------------------------------------------------------------
-- Lamps, switches, gold, keys
----------------------------------------------------------------
local function makeLamp(parent, cf, dark)
	local lamp = newPart(parent, "Lamp", Vector3.new(2.6, 0.5, 2.6), cf, {
		Color = Color3.fromRGB(255, 230, 180),
		Material = dark and Enum.Material.Glass or Enum.Material.Neon,
	}, { CastShadow = false })
	local light = Instance.new("PointLight")
	light.Range = 24
	light.Brightness = 1.5
	light.Color = Color3.fromRGB(255, 214, 160)
	light.Shadows = false
	light.Enabled = not dark
	light.Parent = lamp
	lamp:SetAttribute("Broken", false)
	return lamp
end

local function makeSwitch(parent, cf)
	local switch = newPart(parent, "LightSwitch", Vector3.new(0.8, 1.2, 0.4), cf, STYLE.Metal)
	local prompt = newPrompt(switch, "Lights", "Switch", 8)
	prompt.Name = "SwitchPrompt"
	return switch
end

local function makeGoldPile(parent, cf, amount)
	local pile = newPart(parent, "GoldPile", Vector3.new(0.6, 2.4, 2.4), cf * CFrame.new(0, 0.3, 0) * CFrame.Angles(0, 0, math.rad(90)), STYLE.Gold, {
		Shape = Enum.PartType.Cylinder,
	})
	pile:SetAttribute("Amount", amount)
	local prompt = newPrompt(pile, "Collect", amount .. " Gold", 8)
	prompt.Name = "GoldPrompt"
	return pile
end

local function makeKeyPedestal(parent, cf, doorNumber)
	local model = Instance.new("Model")
	model.Name = "KeyPedestal"
	newPart(model, "Pedestal", Vector3.new(2, 3.4, 2), cf * CFrame.new(0, 1.7, 0), STYLE.Frame)
	local key = newPart(model, "Key", Vector3.new(1.4, 0.25, 0.6), cf * CFrame.new(0, 3.7, 0) * CFrame.Angles(0, math.rad(rng:NextNumber(0, 180)), 0), STYLE.Gold)
	local prompt = newPrompt(key, "Take", "Key for Door " .. doorNumber, 8)
	prompt.Name = "KeyPrompt"
	model.Parent = parent
	return { model = model, key = key, prompt = prompt, doorNumber = doorNumber }
end

----------------------------------------------------------------
-- Bounds / overlap
----------------------------------------------------------------
local function computeBounds(base, width, length, height)
	local a = width / 2 + 1.5
	local points = {
		lcf(base, -a, 0, -1.5).Position,
		lcf(base, a, 0, -1.5).Position,
		lcf(base, -a, 0, length + 1.5).Position,
		lcf(base, a, 0, length + 1.5).Position,
	}
	local minV = points[1]
	local maxV = points[1]
	for _, p in points do
		minV = Vector3.new(math.min(minV.X, p.X), 0, math.min(minV.Z, p.Z))
		maxV = Vector3.new(math.max(maxV.X, p.X), 0, math.max(maxV.Z, p.Z))
	end
	local y = base.Position.Y
	return Vector3.new(minV.X, y - 2, minV.Z), Vector3.new(maxV.X, y + height + 2, maxV.Z)
end

local function boxesOverlap(minA, maxA, minB, maxB)
	local shrink = 1.5 -- adjacent rooms may touch; only true intersection counts
	return minA.X + shrink < maxB.X - shrink
		and maxA.X - shrink > minB.X + shrink
		and minA.Z + shrink < maxB.Z - shrink
		and maxA.Z - shrink > minB.Z + shrink
end

local function wouldOverlap(base, width, length, height)
	local minV, maxV = computeBounds(base, width, length, height)
	for _, room in rooms do
		if boxesOverlap(minV, maxV, room.boundsMin, room.boundsMax) then
			return true
		end
	end
	return false
end

local function pickTemplate()
	local total = 0
	for _, t in Templates do
		total += t.weight
	end
	local roll = rng:NextNumber(0, total)
	for _, t in Templates do
		roll -= t.weight
		if roll <= 0 then
			return t
		end
	end
	return Templates[1]
end

----------------------------------------------------------------
-- Room construction
----------------------------------------------------------------
-- opts: { exit = "end"|"left"|"right"|"none", length, number, locked, dark,
--         isLobby, isShop, isElevator }
local function buildRoom(base, opts)
	local W, H = Config.RoomWidth, Config.RoomHeight
	local L = opts.length
	local number = opts.number

	local model = Instance.new("Model")
	model.Name = "Room_" .. number
	model:SetAttribute("Number", number)

	-- Shell -------------------------------------------------------
	newPart(model, "Floor", Vector3.new(W + 2, 1, L + 2), lcf(base, 0, -0.5, L / 2), STYLE.Floor)
	newPart(model, "Ceiling", Vector3.new(W + 2, 1, L + 2), lcf(base, 0, H + 0.5, L / 2), STYLE.Ceiling)

	buildWall(model, "BackWall", lcf(base, 0, 0, 0), W, H, 1, { offset = 0 })
	local frontGap = if opts.exit == "end" then { offset = opts.exitOffset } else nil
	buildWall(model, "FrontWall", lcf(base, 0, 0, L), W, H, 1, frontGap)

	local sideGapZ = L - Config.SideExitInset
	local leftGap = if opts.exit == "left" then { offset = L / 2 - Config.SideExitInset } else nil
	local rightGap = if opts.exit == "right" then { offset = L / 2 - Config.SideExitInset } else nil
	buildWall(model, "LeftWall", lcf(base, -(W / 2 + 0.5), 0, L / 2, 90), L + 2, H, 1, leftGap)
	buildWall(model, "RightWall", lcf(base, W / 2 + 0.5, 0, L / 2, 90), L + 2, H, 1, rightGap)

	-- Exit doorway ------------------------------------------------
	local exitCF
	if opts.exit == "end" then
		exitCF = lcf(base, opts.exitOffset, 0, L)
	elseif opts.exit == "left" then
		exitCF = lcf(base, -(W / 2 + 0.5), 0, sideGapZ, 90)
	elseif opts.exit == "right" then
		exitCF = lcf(base, W / 2 + 0.5, 0, sideGapZ, -90)
	end

	local record = {
		number = number,
		model = model,
		base = base,
		length = L,
		entryCF = base,
		exitCF = exitCF,
		exitDoor = nil,
		locked = opts.locked or false,
		dark = opts.dark or false,
		isShop = opts.isShop or false,
		isElevator = opts.isElevator or false,
		lights = {},
		closets = {},
		goldPiles = {},
		keyPedestal = nil,
		leverPrompt = nil,
		pathNodes = {},
		boundsMin = nil,
		boundsMax = nil,
	}
	record.boundsMin, record.boundsMax = computeBounds(base, W, L, H)

	-- Rush path nodes: entry -> exit, floating at chest height
	table.insert(record.pathNodes, base.Position + Vector3.new(0, 4.5, 0))
	if exitCF then
		table.insert(record.pathNodes, exitCF.Position + Vector3.new(0, 4.5, 0))
	else
		table.insert(record.pathNodes, lcf(base, 0, 4.5, L - 4).Position)
	end

	-- Exit door (labeled with the NEXT room's number) ---------------
	if exitCF then
		record.exitDoor = makeDoor(model, exitCF, number + 1, record.locked)
	end

	-- Lamps ---------------------------------------------------------
	local lampCount = math.max(1, math.floor(L / Config.LightSpacing))
	for i = 1, lampCount do
		local z = L * (i - 0.5) / lampCount
		table.insert(record.lights, makeLamp(model, lcf(base, 0, H - 0.25, z), record.dark))
	end
	if opts.isShop or opts.isElevator or opts.isLobby then
		-- extra side lamps so safe rooms feel bright
		table.insert(record.lights, makeLamp(model, lcf(base, -W / 4, H - 0.25, L / 2), false))
		table.insert(record.lights, makeLamp(model, lcf(base, W / 4, H - 0.25, L / 2), false))
	end

	-- Light switch ----------------------------------------------------
	if not opts.isElevator and (record.dark or rng:NextNumber() < Config.LightSwitchChance) then
		record.switch = makeSwitch(model, lcf(base, W / 2 - 0.7, 4.5, 5, 90))
	end

	-- Closets -----------------------------------------------------------
	if not opts.isElevator and not opts.isShop then
		local slots = {}
		for z = 8, L - 10, 8 do
			if not (opts.exit == "left" and math.abs(z - sideGapZ) < 7) then
				table.insert(slots, { side = -1, z = z })
			end
			if not (opts.exit == "right" and math.abs(z - sideGapZ) < 7) then
				table.insert(slots, { side = 1, z = z })
			end
		end
		-- shuffle
		for i = #slots, 2, -1 do
			local j = rng:NextInteger(1, i)
			slots[i], slots[j] = slots[j], slots[i]
		end
		local placed = 0
		for _, slot in slots do
			if placed >= Config.MaxClosetsPerRoom then
				break
			end
			if rng:NextNumber() < Config.ClosetChance then
				placed += 1
				local yaw = if slot.side == 1 then 90 else -90
				local closetCF = lcf(base, slot.side * (W / 2 - 1.6), 0, slot.z, yaw)
				table.insert(record.closets, makeCloset(model, closetCF, placed))
			end
		end
	end

	-- Key for a locked exit --------------------------------------------
	if record.locked and record.exitDoor then
		local kx = rng:NextInteger(0, 1) == 0 and -(W / 2 - 4) or (W / 2 - 4)
		local kz = rng:NextInteger(8, math.max(9, L - 10))
		record.keyPedestal = makeKeyPedestal(model, lcf(base, kx, 0, kz), number + 1)
	end

	-- Gold ----------------------------------------------------------------
	if not opts.isLobby and not opts.isElevator and rng:NextNumber() < Config.GoldPileChance then
		local gx = rng:NextInteger(-(W / 2 - 3), W / 2 - 3)
		local gz = rng:NextInteger(6, math.max(7, L - 8))
		local amount = rng:NextInteger(Config.GoldMin, Config.GoldMax)
		table.insert(record.goldPiles, makeGoldPile(model, lcf(base, gx, 0, gz), amount))
	end

	-- Elevator escape (room 100) -------------------------------------------
	if opts.isElevator then
		local eCF = lcf(base, 0, 0, L - 5)
		newPart(model, "ElevBack", Vector3.new(10, 12, 1), eCF * CFrame.new(0, 6, 4), STYLE.Metal)
		newPart(model, "ElevL", Vector3.new(1, 12, 8), eCF * CFrame.new(-5, 6, 0), STYLE.Metal)
		newPart(model, "ElevR", Vector3.new(1, 12, 8), eCF * CFrame.new(5, 6, 0), STYLE.Metal)
		newPart(model, "ElevTop", Vector3.new(10, 1, 8), eCF * CFrame.new(0, 12, 0), STYLE.Metal)
		local lever = newPart(model, "Lever", Vector3.new(1, 2.4, 1), eCF * CFrame.new(3.5, 3.5, 2.8), STYLE.Gold)
		record.leverPrompt = newPrompt(lever, "Pull Lever", "Escape", 8)
		SoundUtil.play3D(AudioIds.ElevatorDing, lever)
	end

	model.Parent = roomsFolder
	return record
end

----------------------------------------------------------------
-- Culling (Void)
----------------------------------------------------------------
local function positionInBounds(pos, minV, maxV)
	return pos.X > minV.X and pos.X < maxV.X and pos.Y > minV.Y and pos.Y < maxV.Y and pos.Z > minV.Z and pos.Z < maxV.Z
end

function RoomGenerator.getRoomOfPosition(pos: Vector3)
	for _, room in rooms do
		if positionInBounds(pos, room.boundsMin, room.boundsMax) then
			return room
		end
	end
	return nil
end

local function cullOldRooms()
	while #rooms > Config.MaxLoadedRooms do
		local old = table.remove(rooms, 1)
		local safeRoom = rooms[1]
		ctx.HidingService.forceExitAll(old)
		ctx.EntityService.onRoomCulled(old)
		for _, player in Players:GetPlayers() do
			local char = player.Character
			local hrp = char and char:FindFirstChild("HumanoidRootPart")
			local humanoid = char and char:FindFirstChildOfClass("Humanoid")
			if hrp and humanoid and humanoid.Health > 0 and positionInBounds(hrp.Position, old.boundsMin, old.boundsMax) then
				hrp.CFrame = safeRoom.entryCF * CFrame.new(0, 4, -4)
				humanoid:TakeDamage(Config.VoidDamage)
				ctx.Remotes.Notify:FireClient(player, "The Void dragged you forward...", Color3.fromRGB(160, 60, 200))
			end
		end
		old.model:Destroy()
	end
end

----------------------------------------------------------------
-- Public API
----------------------------------------------------------------
function RoomGenerator.init(context)
	ctx = context
	roomsFolder = workspace:FindFirstChild("Rooms") or Instance.new("Folder")
	roomsFolder.Name = "Rooms"
	roomsFolder.Parent = workspace
end

function RoomGenerator.getActiveRooms()
	return rooms
end

function RoomGenerator.getCurrentRoom()
	return rooms[#rooms]
end

local function registerWithServices(record)
	ctx.DoorService.registerRoom(record)
	ctx.HidingService.registerRoom(record)
	ctx.LightingService.registerRoom(record)
	ctx.InventoryService.registerRoom(record)
	if record.isShop then
		ctx.ItemService.addShopPedestals(record, "shop")
	end
end

-- Destroys everything and rebuilds the lobby (room 0). Called at boot and
-- after a wipe or a win.
function RoomGenerator.reset()
	for _, room in rooms do
		room.model:Destroy()
	end
	table.clear(rooms)
	roomsFolder:ClearAllChildren()

	local lobbyBase = CFrame.new(0, 1, 0) -- LookVector = -Z = "into the room"
	local record = buildRoom(lobbyBase, {
		number = 0,
		length = 44,
		exit = "end",
		exitOffset = 0,
		isLobby = true,
	})
	table.insert(rooms, record)
	registerWithServices(record)
	ctx.ItemService.addShopPedestals(record, "lobby")
	return record
end

-- Builds the next room attached to the current room's exit door.
function RoomGenerator.generateNext()
	local current = rooms[#rooms]
	assert(current and current.exitCF, "current room has no exit")
	local number = current.number + 1
	local base = current.exitCF * CFrame.new(0, 0, -1.2) -- step past the shared wall

	local opts
	if number == Config.FinalRoom then
		opts = { number = number, length = 30, exit = "none", isElevator = true }
	elseif number == Config.ShopRoom then
		opts = { number = number, length = 44, exit = "end", exitOffset = 0, isShop = true }
	else
		-- weighted roll with overlap re-rolls; fall back to a straight hallway
		for attempt = 1, 8 do
			local template = attempt <= 5 and pickTemplate() or Templates[1]
			local length = rng:NextInteger(template.length[1], template.length[2])
			if not wouldOverlap(base, Config.RoomWidth, length, Config.RoomHeight) or attempt == 8 then
				local offsets = { -Config.RoomWidth / 4, 0, Config.RoomWidth / 4 }
				opts = {
					number = number,
					length = length,
					exit = template.exit,
					exitOffset = offsets[rng:NextInteger(1, 3)],
				}
				break
			end
		end
		opts.locked = number + 1 ~= Config.ShopRoom -- never lock the shop door
			and number >= Config.LockedDoorMinRoom
			and rng:NextNumber() < Config.LockedDoorChance
		opts.dark = (number >= Config.GreenhouseStart and number < Config.FinalRoom)
			or (number >= Config.DarkRoomMinRoom and rng:NextNumber() < Config.DarkRoomChance)
	end

	local record = buildRoom(base, opts)
	table.insert(rooms, record)
	registerWithServices(record)
	cullOldRooms()
	return record
end

return RoomGenerator
