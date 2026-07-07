-- DataService (ModuleScript) -> ServerScriptService/DoorsServer/DataService
--
-- Persistent knobs (the meta currency) via DataStore. Degrades gracefully:
-- if DataStores are unavailable (Studio without API access enabled), knobs
-- simply live in memory for the session and a warning is printed once.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local DataService = {}
local ctx

local store = nil
local dirty = {} -- [player] = true when knobs changed since last save

function DataService.init(context)
	ctx = context
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("DoorsKnobs_v1")
	end)
	if ok then
		store = result
	else
		warn("[DoorsGame] DataStores unavailable, knobs won't persist: " .. tostring(result))
	end

	-- autosave sweep
	task.spawn(function()
		while true do
			task.wait(60)
			for player in dirty do
				DataService.save(player)
			end
		end
	end)

	game:BindToClose(function()
		for _, player in Players:GetPlayers() do
			DataService.save(player)
		end
	end)
end

local function knobsValue(player: Player): IntValue?
	local stats = player:FindFirstChild("leaderstats")
	return stats and stats:FindFirstChild("Knobs") :: IntValue
end

-- Called by Main after leaderstats exist.
function DataService.setupPlayer(player: Player)
	local value = knobsValue(player)
	if not value then
		return
	end
	if store then
		local ok, saved = pcall(function()
			return store:GetAsync("knobs_" .. player.UserId)
		end)
		if ok and typeof(saved) == "number" then
			value.Value = saved
		end
	end
end

function DataService.save(player: Player)
	dirty[player] = nil
	local value = knobsValue(player)
	if not store or not value then
		return
	end
	local amount = value.Value
	pcall(function()
		store:SetAsync("knobs_" .. player.UserId, amount)
	end)
end

function DataService.removePlayer(player: Player)
	DataService.save(player)
end

function DataService.addKnobs(player: Player, amount: number)
	local value = knobsValue(player)
	if value and amount > 0 then
		value.Value += amount
		dirty[player] = true
	end
end

function DataService.spendKnobs(player: Player, amount: number): boolean
	local value = knobsValue(player)
	if value and value.Value >= amount then
		value.Value -= amount
		dirty[player] = true
		return true
	end
	return false
end

return DataService
