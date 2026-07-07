-- UIBuilder (ModuleScript) -> StarterPlayerScripts/DoorsClient/UIBuilder
-- Builds the whole HUD in code (no StarterGui setup needed) and returns a
-- small API the client script drives.

local TweenService = game:GetService("TweenService")

local UIBuilder = {}

local function label(parent, props): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.Antique
	l.TextScaled = true
	l.TextColor3 = Color3.fromRGB(215, 195, 160)
	for key, value in props do
		(l :: any)[key] = value
	end
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.new(0, 0, 0)
	stroke.Thickness = 1.5
	stroke.Parent = l
	l.Parent = parent
	return l
end

function UIBuilder.build(player: Player)
	local gui = Instance.new("ScreenGui")
	gui.Name = "DoorsHUD"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.Parent = player:WaitForChild("PlayerGui")

	-- Room counter -------------------------------------------------
	local roomLabel = label(gui, {
		Name = "Room",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 10),
		Size = UDim2.new(0, 320, 0, 42),
		Text = "LOBBY",
	})

	-- Currency (top right) ------------------------------------------
	local goldLabel = label(gui, {
		Name = "Gold",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -16, 0, 10),
		Size = UDim2.new(0, 180, 0, 26),
		Text = "Gold: 0",
		TextColor3 = Color3.fromRGB(212, 175, 55),
		TextXAlignment = Enum.TextXAlignment.Right,
	})
	local knobsLabel = label(gui, {
		Name = "Knobs",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -16, 0, 40),
		Size = UDim2.new(0, 180, 0, 26),
		Text = "Knobs: 0",
		TextColor3 = Color3.fromRGB(120, 200, 255),
		TextXAlignment = Enum.TextXAlignment.Right,
	})

	-- Toast (bottom center) -------------------------------------------
	local toast = label(gui, {
		Name = "Toast",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -80),
		Size = UDim2.new(0, 560, 0, 32),
		Text = "",
		TextTransparency = 1,
	})

	-- GET OUT warning ------------------------------------------------
	local getOut = label(gui, {
		Name = "GetOut",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.35, 0),
		Size = UDim2.new(0, 500, 0, 90),
		Text = "GET OUT",
		TextColor3 = Color3.fromRGB(255, 40, 40),
		Visible = false,
	})

	-- Letterbox bars shown while hiding ---------------------------------
	local function bar(name, anchorY, posY)
		local frame = Instance.new("Frame")
		frame.Name = name
		frame.AnchorPoint = Vector2.new(0.5, anchorY)
		frame.Position = UDim2.new(0.5, 0, posY, 0)
		frame.Size = UDim2.new(1, 0, 0.14, 0)
		frame.BackgroundColor3 = Color3.new(0, 0, 0)
		frame.BorderSizePixel = 0
		frame.Visible = false
		frame.Parent = gui
		return frame
	end
	local barTop = bar("BarTop", 0, 0)
	local barBottom = bar("BarBottom", 1, 1)

	-- Damage / effect flash ------------------------------------------------
	local flash = Instance.new("Frame")
	flash.Name = "Flash"
	flash.Size = UDim2.fromScale(1, 1)
	flash.BackgroundColor3 = Color3.fromRGB(255, 0, 0)
	flash.BackgroundTransparency = 1
	flash.BorderSizePixel = 0
	flash.ZIndex = 5
	flash.Parent = gui

	-- Full-screen overlay (death / win) --------------------------------------
	local overlay = Instance.new("Frame")
	overlay.Name = "Overlay"
	overlay.Size = UDim2.fromScale(1, 1)
	overlay.BackgroundColor3 = Color3.new(0, 0, 0)
	overlay.BackgroundTransparency = 1
	overlay.BorderSizePixel = 0
	overlay.Visible = false
	overlay.ZIndex = 10
	overlay.Parent = gui
	local overlayTitle = label(overlay, {
		Name = "Title",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.4, 0),
		Size = UDim2.new(0, 700, 0, 70),
		Text = "",
		ZIndex = 11,
	})
	local overlayTip = label(overlay, {
		Name = "Tip",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.52, 0),
		Size = UDim2.new(0, 700, 0, 32),
		Text = "",
		TextColor3 = Color3.fromRGB(170, 160, 150),
		ZIndex = 11,
	})
	local overlayKnobs = label(overlay, {
		Name = "Knobs",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.62, 0),
		Size = UDim2.new(0, 700, 0, 28),
		Text = "",
		TextColor3 = Color3.fromRGB(120, 200, 255),
		ZIndex = 11,
	})

	----------------------------------------------------------------
	-- API
	----------------------------------------------------------------
	local UI = {}
	local toastTween: Tween? = nil

	function UI.setRoom(n: number)
		roomLabel.Text = n <= 0 and "LOBBY" or string.format("ROOM %03d", n)
	end

	function UI.setGold(n: number)
		goldLabel.Text = "Gold: " .. n
	end

	function UI.setKnobs(n: number)
		knobsLabel.Text = "Knobs: " .. n
	end

	function UI.toast(text: string, color: Color3?)
		toast.Text = text
		toast.TextColor3 = color or Color3.fromRGB(215, 195, 160)
		toast.TextTransparency = 0
		if toastTween then
			toastTween:Cancel()
		end
		toastTween = TweenService:Create(toast, TweenInfo.new(1, Enum.EasingStyle.Quad, Enum.EasingDirection.In, 0, false, 2.5), {
			TextTransparency = 1,
		})
		toastTween:Play()
	end

	function UI.setHidden(hidden: boolean)
		barTop.Visible = hidden
		barBottom.Visible = hidden
		if not hidden then
			getOut.Visible = false
		end
	end

	function UI.showGetOut()
		getOut.Visible = true
	end

	function UI.flash(color: Color3)
		flash.BackgroundColor3 = color
		flash.BackgroundTransparency = 0.55
		TweenService:Create(flash, TweenInfo.new(0.6), { BackgroundTransparency = 1 }):Play()
	end

	function UI.showDeath(killer: string, tip: string, knobs: number)
		overlayTitle.Text = "You died to " .. killer
		overlayTitle.TextColor3 = Color3.fromRGB(220, 60, 60)
		overlayTip.Text = tip
		overlayKnobs.Text = knobs > 0 and ("+" .. knobs .. " knobs") or ""
		overlay.BackgroundTransparency = 0
		overlay.Visible = true
	end

	function UI.showWin(knobs: number)
		overlayTitle.Text = "YOU ESCAPED"
		overlayTitle.TextColor3 = Color3.fromRGB(120, 220, 120)
		overlayTip.Text = "Floor 1 complete. The elevator descends..."
		overlayKnobs.Text = "+" .. knobs .. " knobs"
		overlay.BackgroundTransparency = 0
		overlay.Visible = true
	end

	function UI.hideOverlay()
		if overlay.Visible then
			local tween = TweenService:Create(overlay, TweenInfo.new(0.8), { BackgroundTransparency = 1 })
			tween.Completed:Once(function()
				overlay.Visible = false
			end)
			tween:Play()
			overlayTitle.Text = ""
			overlayTip.Text = ""
			overlayKnobs.Text = ""
		end
	end

	return UI
end

return UIBuilder
