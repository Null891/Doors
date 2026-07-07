-- CameraShake (ModuleScript) -> StarterPlayerScripts/DoorsClient/CameraShake
-- Impulse-based camera shake. Call CameraShake.impulse(magnitude) from
-- anywhere; the offset decays smoothly on RenderStepped.

local RunService = game:GetService("RunService")

local CameraShake = {}
local magnitude = 0
local rng = Random.new()

function CameraShake.impulse(amount: number)
	magnitude = math.max(magnitude, amount)
end

function CameraShake.start()
	RunService:BindToRenderStep("DoorsCameraShake", Enum.RenderPriority.Camera.Value + 1, function(dt)
		if magnitude < 0.005 then
			magnitude = 0
			return
		end
		local camera = workspace.CurrentCamera
		if camera then
			local m = magnitude
			camera.CFrame = camera.CFrame * CFrame.Angles(
				math.rad(rng:NextNumber(-m, m)),
				math.rad(rng:NextNumber(-m, m)),
				0
			)
		end
		magnitude *= math.exp(-6 * dt) -- smooth decay
	end)
end

return CameraShake
