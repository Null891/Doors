-- SoundUtil (ModuleScript) -> ReplicatedStorage/Shared/SoundUtil
-- Tiny wrapper around Sound creation. Treats asset id 0 as "not configured"
-- and no-ops, so the kit works before any audio ids are filled in.

local SoundService = game:GetService("SoundService")

local SoundUtil = {}

-- Creates (but does not play) a Sound. Returns nil if id is 0.
function SoundUtil.make(id: number, parent: Instance, props: { [string]: any }?): Sound?
	if not id or id == 0 then
		return nil
	end
	local sound = Instance.new("Sound")
	sound.SoundId = "rbxassetid://" .. id
	if props then
		for key, value in props do
			(sound :: any)[key] = value
		end
	end
	sound.Parent = parent
	return sound
end

-- One-shot 3D sound attached to a part/attachment; cleans itself up.
function SoundUtil.play3D(id: number, parent: Instance, props: { [string]: any }?): Sound?
	local sound = SoundUtil.make(id, parent, props)
	if not sound then
		return nil
	end
	sound.Ended:Once(function()
		sound:Destroy()
	end)
	task.delay(20, function() -- safety net for loops / failed loads
		if sound.Parent then
			sound:Destroy()
		end
	end)
	sound:Play()
	return sound
end

-- One-shot non-spatial sound (client UI cues). Parented to SoundService.
function SoundUtil.play2D(id: number, props: { [string]: any }?): Sound?
	return SoundUtil.play3D(id, SoundService, props)
end

return SoundUtil
