-- ItemService (ModuleScript) -> ServerScriptService/DoorsServer/ItemService
--
-- Builds every purchasable item as a procedural Tool (no assets) and wires
-- up shop pedestals: gold prices mid-run at Jeff's shop (room 52), knob
-- prices at the lobby pedestals.
--
--   Flashlight - toggleable SpotLight with a draining battery
--   Vitamins   - one-shot speed boost
--   Crucifix   - passive; sweepers check for it and get banished
--   Lockpick   - not a Tool, adds a charge to InventoryService

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.GameConfig)
local SoundUtil = require(Shared.SoundUtil)
local AudioIds = require(Shared.AudioIds)

local ItemService = {}
local ctx

function ItemService.init(context)
	ctx = context
end

----------------------------------------------------------------
-- Tool builders
----------------------------------------------------------------
local function makeHandle(tool: Tool, size: Vector3, color: Color3, material: Enum.Material)
	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = size
	handle.Color = color
	handle.Material = material
	handle.CanCollide = false
	handle.Parent = tool
	return handle
end

local function makeFlashlight(): Tool
	local tool = Instance.new("Tool")
	tool.Name = "Flashlight"
	tool.RequiresHandle = true
	tool.CanBeDropped = false
	tool.ToolTip = "Click to toggle"
	tool:SetAttribute("Battery", Config.FlashlightSeconds)

	local handle = makeHandle(tool, Vector3.new(0.8, 0.8, 2.4), Color3.fromRGB(60, 60, 65), Enum.Material.Metal)
	local beam = Instance.new("SpotLight")
	beam.Name = "Beam"
	beam.Angle = 40
	beam.Range = 42
	beam.Brightness = 3
	beam.Face = Enum.NormalId.Front
	beam.Enabled = false
	beam.Parent = handle

	tool.Activated:Connect(function()
		if tool:GetAttribute("Battery") > 0 then
			beam.Enabled = not beam.Enabled
			SoundUtil.play3D(AudioIds.LightSwitch, handle)
		end
	end)
	tool.Unequipped:Connect(function()
		beam.Enabled = false
	end)

	-- battery drain
	task.spawn(function()
		while tool.Parent do
			task.wait(1)
			if beam.Enabled then
				local battery = math.max(0, tool:GetAttribute("Battery") - 1)
				tool:SetAttribute("Battery", battery)
				if battery <= 0 then
					beam.Enabled = false
					tool.ToolTip = "Dead battery"
				end
			end
		end
	end)
	return tool
end

local function makeVitamins(): Tool
	local tool = Instance.new("Tool")
	tool.Name = "Vitamins"
	tool.RequiresHandle = true
	tool.CanBeDropped = false
	tool.ToolTip = "Click to gulp"
	makeHandle(tool, Vector3.new(0.7, 1.1, 0.7), Color3.fromRGB(230, 120, 60), Enum.Material.Glass)

	local used = false
	tool.Activated:Connect(function()
		if used then
			return
		end
		used = true
		local char = tool.Parent
		local humanoid = char and char:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.WalkSpeed = Config.WalkSpeed + Config.VitaminsSpeedBoost
			task.delay(Config.VitaminsDuration, function()
				if humanoid.Parent then
					humanoid.WalkSpeed = Config.WalkSpeed
				end
			end)
		end
		tool:Destroy()
	end)
	return tool
end

local function makeCrucifix(): Tool
	local tool = Instance.new("Tool")
	tool.Name = "Crucifix"
	tool.RequiresHandle = true
	tool.CanBeDropped = false
	tool.ToolTip = "Hold it out when something comes"
	local handle = makeHandle(tool, Vector3.new(0.4, 2, 0.4), Color3.fromRGB(212, 175, 55), Enum.Material.Metal)
	local crossbar = Instance.new("Part")
	crossbar.Name = "Crossbar"
	crossbar.Size = Vector3.new(1.4, 0.35, 0.35)
	crossbar.Color = handle.Color
	crossbar.Material = handle.Material
	crossbar.CanCollide = false
	crossbar.Parent = tool
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = handle
	weld.Part1 = crossbar
	weld.Parent = crossbar
	crossbar.CFrame = handle.CFrame * CFrame.new(0, 0.5, 0)
	return tool
end

local builders = {
	Flashlight = makeFlashlight,
	Vitamins = makeVitamins,
	Crucifix = makeCrucifix,
}

local function giveItem(player: Player, itemName: string): boolean
	if itemName == "Lockpick" then
		ctx.InventoryService.addLockpick(player)
		return true
	end
	local builder = builders[itemName]
	if not builder then
		return false
	end
	local backpack = player:FindFirstChild("Backpack")
	if not backpack then
		return false
	end
	builder().Parent = backpack
	return true
end

----------------------------------------------------------------
-- Shop pedestals
----------------------------------------------------------------
-- mode = "shop" (gold prices) or "lobby" (knob prices)
function ItemService.addShopPedestals(record, mode: string)
	local prices = mode == "shop" and Config.ShopPrices or Config.LobbyPrices
	local currency = mode == "shop" and "gold" or "knobs"

	local names = {}
	for name in prices do
		table.insert(names, name)
	end
	table.sort(names)

	local base = record.entryCF
	local W = Config.RoomWidth
	for i, itemName in names do
		local price = prices[itemName]
		local side = (i % 2 == 0) and 1 or -1
		local z = 10 + math.floor((i - 1) / 2) * 8

		local pedestal = Instance.new("Part")
		pedestal.Name = "ShopPedestal_" .. itemName
		pedestal.Size = Vector3.new(2.4, 3.4, 2.4)
		pedestal.Color = Color3.fromRGB(38, 26, 20)
		pedestal.Material = Enum.Material.Wood
		pedestal.Anchored = true
		pedestal.CFrame = base * CFrame.new(side * (W / 2 - 4), 1.7, -z)
		pedestal.Parent = record.model

		local display = Instance.new("Part")
		display.Name = "Display"
		display.Size = Vector3.new(1.2, 1.2, 1.2)
		display.Color = Color3.fromRGB(212, 175, 55)
		display.Material = Enum.Material.Neon
		display.Anchored = true
		display.CanCollide = false
		display.CFrame = pedestal.CFrame * CFrame.new(0, 2.6, 0)
		display.Parent = record.model

		local gui = Instance.new("BillboardGui")
		gui.Size = UDim2.fromScale(6, 1.6)
		gui.StudsOffset = Vector3.new(0, 2.4, 0)
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.Antique
		label.TextScaled = true
		label.TextColor3 = Color3.fromRGB(215, 195, 160)
		label.Text = itemName .. "\n" .. price .. " " .. currency
		label.Parent = gui
		gui.Parent = display

		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Buy"
		prompt.ObjectText = itemName .. " (" .. price .. " " .. currency .. ")"
		prompt.HoldDuration = 0.5
		prompt.MaxActivationDistance = 8
		prompt.RequiresLineOfSight = false
		prompt.Parent = display

		prompt.Triggered:Connect(function(player)
			local paid
			if currency == "gold" then
				paid = ctx.InventoryService.spendGold(player, price)
			else
				paid = ctx.DataService.spendKnobs(player, price)
			end
			if not paid then
				ctx.Remotes.Notify:FireClient(player, "Not enough " .. currency .. ".", Color3.fromRGB(200, 80, 80))
				return
			end
			giveItem(player, itemName)
			SoundUtil.play3D(AudioIds.Purchase, display)
			ctx.Remotes.Notify:FireClient(player, "Bought " .. itemName .. "!", Color3.fromRGB(120, 220, 120))
		end)
	end
end

return ItemService
