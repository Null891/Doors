// hud.js — every 2D interface element, built as DOM inside #hud.
// main.js sets hud.on = { play, retry, quitToMenu, resume } callbacks.

function el(tag, opts = {}, parent = null) {
  const e = document.createElement(tag);
  if (opts.id) e.id = opts.id;
  if (opts.cls) e.className = opts.cls;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.html != null) e.innerHTML = opts.html;
  if (parent) parent.appendChild(e);
  return e;
}

// Per-killer face/silhouette skins, shared by the jumpscare canvas (scare)
// and the death-screen portrait (showDeath). Each entry is a recipe the
// procedural _drawFace() interprets — no external art, everything is drawn.
//   skin  : head fill        eye  : iris/teeth colour     glow : rim aura
//   eyes  : 0 none · 1 single cyclops · 2 pair · >2 scattered swarm
//   mouth : draw a jagged maw          spider/goop/wide : per-entity flourishes
const FACE_STYLES = {
  rush:    { skin: '#0a0a0d', eye: '#e8e8f2', mouth: true,  eyes: 2, glow: '#334' },
  ambush:  { skin: '#08120a', eye: '#8dff9d', mouth: true,  eyes: 3, glow: '#0f0' },
  screech: { skin: '#050505', eye: '#ffffff', mouth: true,  eyes: 2, glow: '#222', wide: true },
  dupe:    { skin: '#120b08', eye: '#ffd27e', mouth: true,  eyes: 2, glow: '#420' },
  jack:    { skin: '#dcdcdc', eye: '#111111', mouth: false, eyes: 2, glow: '#fff' },
  figure:  { skin: '#1a0d0d', eye: '#000000', mouth: true,  eyes: 0, glow: '#400' },
  halt:    { skin: '#0a1420', eye: '#9fdcff', mouth: false, eyes: 2, glow: '#08f' },
  hide:    { skin: '#0d0d0d', eye: '#c8c8c8', mouth: false, eyes: 2, glow: '#333' },
  eyes:    { skin: '#1c0930', eye: '#e0c0ff', mouth: false, eyes: 8, glow: '#a4e' },
  // NEW: Seek — a single vast eye set in a black tar head that weeps goop.
  seek:    { skin: '#050505', eye: '#f6f6ff', mouth: false, eyes: 1, glow: '#111', goop: true },
  // NEW: Timothy — the tiny drawer spider: small dark body, a cluster of red
  // eyes, and radiating legs.
  timothy: { skin: '#0a0806', eye: '#ff4242', mouth: false, eyes: 6, glow: '#300', spider: true },
};

// Killers arrive at showDeath capitalised (e.g. 'Rush', 'Void'); scares arrive
// lowercase. Normalise either to a FACE_STYLES key, with sensible aliases.
const KILLER_ALIAS = { void: 'eyes', ambush: 'ambush' };
function skinKey(kind) {
  if (!kind) return 'rush';
  const k = String(kind).toLowerCase();
  const mapped = KILLER_ALIAS[k] || k;
  return FACE_STYLES[mapped] ? mapped : 'rush';
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.on = {}; // callbacks injected by main
    this._toastTimer = null;
    this._captionTimer = null;
    this._lastSelectedSlot = 0;
    this._prevSlotSig = new Array(6).fill(null);
    this._lastGold = null;
    this._lastKnobs = null;
    this._build();
  }

  _build() {
    const r = this.root;

    // tints (bottom of the stack)
    el('div', { id: 'vignette', cls: 'fullscreen' }, r);
    this.hurt = el('div', { id: 'hurt-vignette', cls: 'fullscreen' }, r);
    // proximity/danger edge vignette — driven by setDanger(0..1); a red-black
    // rim that intensifies (and pulses when high) while an entity is hunting.
    // Kept separate from #hurt-vignette so health and danger never fight over
    // the same opacity/animation.
    this.dangerEl = el('div', { id: 'danger-vignette', cls: 'fullscreen' }, r);
    this.flashEl = el('div', { id: 'flash', cls: 'fullscreen' }, r);

    // gameplay text
    // room-label holds a text span + a thin door-progress underline (door/100).
    // We update the span's text (not the whole element's textContent) so the
    // progress child is never wiped on a room change.
    this.roomLabel = el('div', { id: 'room-label', cls: 'hud-label' }, r);
    this.roomLabelText = el('span', { cls: 'rl-text', text: 'LOBBY' }, this.roomLabel);
    this.roomProgress = el('i', { cls: 'rl-progress' }, this.roomLabel);
    this.roomProgressFill = el('b', {}, this.roomProgress);
    this.currency = el('div', { id: 'currency', cls: 'hud-label' }, r);
    this.goldEl = el('div', { cls: 'gold', text: 'Gold  0' }, this.currency);
    this.knobsEl = el('div', { cls: 'knobs', text: 'Knobs  0' }, this.currency);
    this.keysEl = el('div', { cls: 'keys', text: '' }, this.currency);
    this.crosshair = el('div', { id: 'crosshair' }, r);
    this.promptEl = el('div', { id: 'prompt' }, r);
    el('span', { cls: 'key', text: 'E' }, this.promptEl);
    this.promptTextEl = el('span', { cls: 'prompt-text' }, this.promptEl);
    this.objectiveEl = el('div', { id: 'objective', cls: 'hud-label' }, r);
    this.toastEl = el('div', { id: 'toast', cls: 'hud-label' }, r);
    this.captionEl = el('div', { id: 'caption' }, r);
    // Guiding Light narration line (letter-reveal, gold) — see narrate()
    this.narrateEl = el('div', { id: 'narrate' }, r);
    this.warnEl = el('div', { id: 'big-warning' }, r);

    // hotbar
    this.hotbarEl = el('div', { id: 'hotbar' }, r);
    this.slotEls = [];
    for (let i = 0; i < 6; i++) {
      const s = el('div', { cls: 'slot' }, this.hotbarEl);
      el('span', { cls: 'num', text: String(i + 1) }, s);
      const count = el('span', { cls: 'count' }, s);
      const icon = el('span', { cls: 'icon' }, s);
      const meter = el('span', { cls: 'meter' }, s);
      const fill = el('i', {}, meter);
      meter.style.display = 'none';
      count.style.display = 'none';
      this.slotEls.push({ root: s, icon, meter, fill, count });
    }
    // persistent reminder of what the selected item does — the piece that was
    // missing when players couldn't tell how to use what they bought.
    this.hotbarHint = el('div', { id: 'hotbar-hint' }, r);

    // health bar — bottom-left, always visible in play. A heart pip + a
    // fill that shifts green→amber→red as it drops, plus a numeric readout.
    this.healthEl = el('div', { id: 'health' }, r);
    el('span', { cls: 'heart', text: '♥' }, this.healthEl);
    const healthTrack = el('div', { cls: 'health-track' }, this.healthEl);
    this.healthFill = el('i', {}, healthTrack);
    this.healthNum = el('span', { cls: 'health-num', text: '100' }, this.healthEl);

    // stamina bar — sits just above the hotbar, hidden while full and fading
    // in only while sprinting drains it (driven by setStamina()).
    this.staminaEl = el('div', { id: 'stamina' }, r);
    this.staminaFill = el('i', {}, this.staminaEl);

    // jumpscare + fade (near top)
    this.scareEl = el('div', { id: 'scare' }, r);
    this.scareCanvas = el('canvas', {}, this.scareEl);
    this.scareCanvas.width = 512;
    this.scareCanvas.height = 512;
    this.fadeEl = el('div', { id: 'fade', cls: 'fullscreen' }, r);

    // sits between the live 3D menu background and the menu text — a
    // blur+gradient veil so the scene reads as mood, not visual noise
    this.menuBackdrop = el('div', { id: 'menu-backdrop' }, r);

    this._buildScreens();
    this._buildPadlock();
    this._buildPaper();
    this._buildBreaker();
    this._buildLoading();
  }

  // Animated intro / loading overlay. Purely visual (pointer-events:none) so
  // it can never permanently trap input — showLoading()/hideLoading() just
  // fade it. A slow "doors opening" motif + a shimmering bar + rotating tips.
  _buildLoading() {
    this.loadingEl = el('div', { id: 'loading' }, this.root);
    const inner = el('div', { cls: 'loading-inner' }, this.loadingEl);
    // two door leaves that ease apart behind the title
    const doors = el('div', { cls: 'loading-doors' }, inner);
    el('span', { cls: 'leaf left' }, doors);
    el('span', { cls: 'leaf right' }, doors);
    el('div', { cls: 'loading-eyebrow', text: 'A HORROR EXPERIENCE' }, inner);
    el('h1', { cls: 'loading-title', text: 'A HUNDRED DOORS' }, inner);
    const bar = el('div', { cls: 'loading-bar' }, inner);
    el('i', {}, bar);
    this.loadingTip = el('div', { cls: 'loading-tip' }, inner);
    this._loadingTips = [
      'When the lights flicker — hide.',
      'In darkness, when something whispers — look at it.',
      'If it watches from the middle of a room — don\'t look.',
      'Closets are safe. Usually.',
      'Track the real door number.',
      'Keep moving. Never fall behind.',
    ];
  }

  // ---------------------------------------------------------------
  _buildScreens() {
    const r = this.root;

    // MENU — the live 3D lobby renders behind this; #menu-backdrop (a blur
    // + gradient scrim) sits between the canvas and this content so the
    // scene reads as atmosphere, not noise, without main.js needing to
    // know anything about how the menu is styled.
    this.menuEl = el('div', { cls: 'screen menu-screen', id: 'menu-screen' }, r);
    const menuContent = el('div', { cls: 'menu-content' }, this.menuEl);

    el('div', { cls: 'menu-eyebrow reveal', text: 'A HORROR EXPERIENCE' }, menuContent);
    el('h1', { cls: 'menu-title reveal', text: 'A HUNDRED DOORS' }, menuContent);
    el('div', { cls: 'sub reveal', text: 'The elevator is broken. The only way out is through.' }, menuContent);
    this.menuStats = el('div', { cls: 'stats reveal' }, menuContent);
    const playBtn = el('button', { cls: 'btn primary reveal', text: 'ENTER THE HOTEL' }, menuContent);
    playBtn.addEventListener('click', () => this.on.play?.());

    el('div', {
      cls: 'controls-hint reveal',
      html: '<b>WASD</b> move &nbsp;·&nbsp; <b>Mouse</b> look &nbsp;·&nbsp; <b>E</b> interact &nbsp;·&nbsp; ' +
            '<b>Shift</b> sprint &nbsp;·&nbsp; <b>C / Ctrl</b> crouch &nbsp;·&nbsp; <b>1–6 / scroll</b> items &nbsp;·&nbsp; <b>F</b> / click — use item &nbsp;·&nbsp; <b>Esc</b> pause' +
            '<br>When the lights flicker — <b>hide</b>. In darkness, when something whispers — <b>look at it</b>. ' +
            'If something watches from the middle of a room — <b>don\'t look</b>.',
    }, menuContent);

    // sliders
    const sliders = el('div', { cls: 'slider-row reveal' }, menuContent);
    const volGroup = el('div', { cls: 'slider-group' }, sliders);
    el('label', { text: 'Volume' }, volGroup);
    this.volSlider = el('input', {}, volGroup);
    Object.assign(this.volSlider, { type: 'range', min: 0, max: 100, value: 80 });
    const sensGroup = el('div', { cls: 'slider-group' }, sliders);
    el('label', { text: 'Sensitivity' }, sensGroup);
    this.sensSlider = el('input', {}, sensGroup);
    Object.assign(this.sensSlider, { type: 'range', min: 20, max: 200, value: 100 });

    // save code — knobs/deepest-door are localStorage-only by default, so
    // this is the only way to move progress to another browser or back it up
    const saveWrap = el('div', { cls: 'save-code-wrap reveal' }, menuContent);
    el('div', { cls: 'save-code-label', text: 'PROGRESS SAVE CODE' }, saveWrap);
    const codeRow = el('div', { cls: 'save-code-row' }, saveWrap);
    this.saveCodeInput = el('input', { cls: 'save-code-input' }, codeRow);
    this.saveCodeInput.readOnly = true;
    this.saveCodeInput.addEventListener('click', () => this.saveCodeInput.select());
    const copyBtn = el('button', { cls: 'btn small', text: 'Copy' }, codeRow);
    copyBtn.addEventListener('click', () => this.on.copyCode?.());
    const importRow = el('div', { cls: 'save-code-row' }, saveWrap);
    this.importCodeInput = el('input', { cls: 'save-code-input' }, importRow);
    this.importCodeInput.placeholder = 'Paste a code to restore progress...';
    const importBtn = el('button', { cls: 'btn small', text: 'Import' }, importRow);
    importBtn.addEventListener('click', () => {
      this.on.importCode?.(this.importCodeInput.value);
      this.importCodeInput.value = '';
    });
    this.saveCodeMsg = el('div', { cls: 'save-code-msg' }, saveWrap);

    // DEATH — a per-killer silhouette portrait sits above the title, drawn
    // from the same FACE_STYLES table the jumpscare uses so every entity
    // (and any new one) already has a death skin.
    this.deathEl = el('div', { cls: 'screen death-screen' }, r);
    const deathArtWrap = el('div', { cls: 'death-art' }, this.deathEl);
    this.deathArtCanvas = el('canvas', {}, deathArtWrap);
    this.deathArtCanvas.width = 512;
    this.deathArtCanvas.height = 512;
    this.deathTitle = el('h2', { text: 'YOU DIED' }, this.deathEl);
    // Guiding Light's whispered line, revealed letter by letter above the tip
    this.deathQuote = el('div', { cls: 'guiding-quote' }, this.deathEl);
    this.deathTip = el('div', { cls: 'tip' }, this.deathEl);
    this.deathKnobs = el('div', { cls: 'knob-gain' }, this.deathEl);
    this.deathStats = el('div', { cls: 'stats' }, this.deathEl);
    const retryBtn = el('button', { cls: 'btn primary', text: 'TRY AGAIN' }, this.deathEl);
    retryBtn.addEventListener('click', () => this.on.retry?.());
    const deathMenuBtn = el('button', { cls: 'btn', text: 'MAIN MENU' }, this.deathEl);
    deathMenuBtn.addEventListener('click', () => this.on.quitToMenu?.());

    // WIN
    this.winEl = el('div', { cls: 'screen' }, r);
    el('h2', { cls: 'win', text: 'YOU ESCAPED' }, this.winEl);
    el('div', { cls: 'sub', text: 'Door 100. The elevator shudders downward, into the dark below…' }, this.winEl);
    this.winKnobs = el('div', { cls: 'knob-gain' }, this.winEl);
    this.winStats = el('div', { cls: 'stats' }, this.winEl);
    const winAgain = el('button', { cls: 'btn primary', text: 'RUN IT BACK' }, this.winEl);
    winAgain.addEventListener('click', () => this.on.retry?.());
    const winMenu = el('button', { cls: 'btn', text: 'MAIN MENU' }, this.winEl);
    winMenu.addEventListener('click', () => this.on.quitToMenu?.());

    // PAUSE
    this.pauseEl = el('div', { cls: 'screen' }, r);
    el('h2', { text: 'PAUSED' }, this.pauseEl);
    el('div', { cls: 'sub', text: 'The hotel waits.' }, this.pauseEl);
    const resumeBtn = el('button', { cls: 'btn primary', text: 'RESUME' }, this.pauseEl);
    resumeBtn.addEventListener('click', () => this.on.resume?.());
    const pauseMenuBtn = el('button', { cls: 'btn', text: 'ABANDON RUN' }, this.pauseEl);
    pauseMenuBtn.addEventListener('click', () => this.on.quitToMenu?.());
  }

  _buildPadlock() {
    this.padlockEl = el('div', { id: 'padlock' }, this.root);
    const body = el('div', { cls: 'body' }, this.padlockEl);
    el('div', { cls: 'title', text: 'FIVE-DIGIT PADLOCK' }, body);
    const wheels = el('div', { cls: 'wheels' }, body);
    this.wheelDigits = [];
    this._padDigits = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
      const wl = el('div', { cls: 'wheel' }, wheels);
      const up = el('button', { text: '▲' }, wl);
      const digit = el('div', { cls: 'digit', text: '0' }, wl);
      const down = el('button', { text: '▼' }, wl);
      up.addEventListener('click', () => this._spinWheel(i, 1));
      down.addEventListener('click', () => this._spinWheel(i, -1));
      this.wheelDigits.push(digit);
    }
    this.padMsg = el('div', { cls: 'msg' }, body);
    const row = el('div', {}, body);
    const tryBtn = el('button', { cls: 'btn primary', text: 'TRY' }, row);
    const cancelBtn = el('button', { cls: 'btn', text: 'LEAVE' }, row);
    cancelBtn.style.marginLeft = '1rem';
    tryBtn.addEventListener('click', () => {
      this._padSubmit?.(this._padDigits.join(''));
    });
    cancelBtn.addEventListener('click', () => this.padlockClose());
  }

  _spinWheel(i, delta) {
    this._padDigits[i] = (this._padDigits[i] + delta + 10) % 10;
    this.wheelDigits[i].textContent = String(this._padDigits[i]);
    this.onPadClick?.();
  }

  padlockOpen(onSubmit) {
    this._padSubmit = onSubmit;
    this.padMsg.textContent = '';
    this.padlockEl.classList.add('visible');
  }
  padlockMsg(text) { this.padMsg.textContent = text; }
  padlockClose() {
    this.padlockEl.classList.remove('visible');
    this._padSubmit = null;
    this.onModalClose?.();
  }
  get padlockVisible() { return this.padlockEl.classList.contains('visible'); }

  _buildPaper() {
    this.paperEl = el('div', { id: 'paper' }, this.root);
    this.paperSheet = el('div', { cls: 'sheet' }, this.paperEl);
    this.paperEl.addEventListener('click', () => this.paperHide());
  }
  paperShow(html) {
    this.paperSheet.innerHTML = html + '<small>(click or press E to put it down)</small>';
    this.paperEl.classList.add('visible');
  }
  paperHide() {
    this.paperEl.classList.remove('visible');
    this.onModalClose?.();
  }
  get paperVisible() { return this.paperEl.classList.contains('visible'); }

  _buildBreaker() {
    this.breakerEl = el('div', { id: 'breaker' }, this.root);
    const body = el('div', { cls: 'body' }, this.breakerEl);
    this.breakerTitle = el('div', { cls: 'title' }, body);
    this.breakerStatus = el('div', { cls: 'b-status' }, body);
    const timerWrap = el('div', { cls: 'timer-wrap' }, body);
    this.breakerTimerBar = el('div', { cls: 'timer-bar' }, timerWrap);
    const grid = el('div', { cls: 'switch-grid' }, body);
    this.breakerButtons = [];
    for (let i = 0; i < 10; i++) {
      const btn = el('button', { cls: 'switch-btn' }, grid);
      el('span', { cls: 'num', text: String(i + 1) }, btn);
      btn.addEventListener('click', () => this._onBreakerClick?.(i + 1));
      this.breakerButtons.push(btn);
    }
    this.breakerMsgEl = el('div', { cls: 'msg' }, body);
    const row = el('div', {}, body);
    const submitBtn = el('button', { cls: 'btn primary', text: 'SUBMIT' }, row);
    submitBtn.addEventListener('click', () => this._onBreakerSubmit?.());
    const leaveBtn = el('button', { cls: 'btn', text: 'LEAVE' }, row);
    leaveBtn.style.marginLeft = '1rem';
    leaveBtn.addEventListener('click', () => this.breakerClose());
  }

  // callbacks: onClick(switchNum) fires on a switch button press during the
  // input phase; onSubmit() fires on SUBMIT.
  breakerOpen({ onClick, onSubmit }) {
    this._onBreakerClick = onClick;
    this._onBreakerSubmit = onSubmit;
    this.breakerMsgEl.textContent = '';
    this.breakerEl.classList.add('visible');
  }
  breakerSetRound(round, total) {
    this.breakerTitle.textContent = `CIRCUIT BREAKER — ROUND ${round}/${total}`;
  }
  breakerSetStatus(text) { this.breakerStatus.textContent = text; }
  breakerSetTimer(frac) {
    this.breakerTimerBar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }
  // states: array of 10 — true (on), false (off), or null (unknown/mystery)
  breakerSetSwitches(states, interactive) {
    states.forEach((on, i) => {
      const btn = this.breakerButtons[i];
      if (!btn) return;
      btn.classList.toggle('on', on === true);
      btn.classList.toggle('mystery', on === null);
      btn.disabled = !interactive;
    });
  }
  breakerMsg(text) { this.breakerMsgEl.textContent = text; }
  breakerClose() {
    this.breakerEl.classList.remove('visible');
    this._onBreakerClick = null;
    this._onBreakerSubmit = null;
    this.onModalClose?.();
  }
  get breakerVisible() { return this.breakerEl.classList.contains('visible'); }

  get modalOpen() { return this.padlockVisible || this.paperVisible || this.breakerVisible; }

  // ---------------------------------------------------------------
  // retriggers a one-shot CSS animation on an element by removing its class,
  // forcing a reflow, then re-adding it — animations don't replay just from
  // the class already being present, so a plain classList.add() would be a
  // no-op on the 2nd+ call.
  _retrigger(elm, cls) {
    elm.classList.remove(cls);
    void elm.offsetWidth;
    elm.classList.add(cls);
  }

  setRoom(n) {
    const label = n <= 0 ? 'LOBBY' : `ROOM ${String(n).padStart(3, '0')}`;
    if (this.roomLabel.textContent === label) return;
    this.roomLabel.textContent = label;
    this._retrigger(this.roomLabel, 'bump');
  }
  setGold(n) {
    const gained = this._lastGold != null && n > this._lastGold;
    this._lastGold = n;
    this.goldEl.textContent = `Gold  ${n}`;
    if (gained) this._retrigger(this.goldEl, 'pulse-gain');
  }
  setKnobs(n) {
    const gained = this._lastKnobs != null && n > this._lastKnobs;
    this._lastKnobs = n;
    this.knobsEl.textContent = `Knobs  ${n}`;
    if (gained) this._retrigger(this.knobsEl, 'pulse-gain');
  }
  setKeys(n) { this.keysEl.textContent = n > 0 ? `Keys  ${n}` : ''; }

  prompt(text) {
    if (!text) {
      this.promptEl.classList.remove('visible');
      this.crosshair.classList.remove('active');
      return;
    }
    this.promptTextEl.textContent = text;
    this.promptEl.classList.add('visible');
    this.crosshair.classList.add('active');
  }

  toast(text, color = null, dur = 3) {
    this.toastEl.textContent = text;
    this.toastEl.style.color = color || 'var(--parchment)';
    this.toastEl.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.classList.remove('visible'); }, dur * 1000);
  }

  caption(text, dur = 4) {
    clearTimeout(this._captionTimer);
    if (!text) {
      this.captionEl.classList.remove('visible');
      return;
    }
    this.captionEl.textContent = text;
    this.captionEl.classList.add('visible');
    this._captionTimer = setTimeout(() => { this.captionEl.classList.remove('visible'); }, dur * 1000);
  }

  bigWarning(text) {
    if (!text) {
      this.warnEl.classList.remove('visible');
    } else {
      this.warnEl.textContent = text;
      this.warnEl.classList.add('visible');
    }
  }

  objective(text) {
    this.objectiveEl.textContent = text || '';
    this.objectiveEl.classList.toggle('visible', !!text);
  }

  setHealth(frac) {
    const f = Math.max(0, Math.min(1, frac));
    this.hurt.style.opacity = String((1 - f) * 0.9);
    this.hurt.classList.toggle('critical', f > 0 && f < 0.3);
    // bar: width + colour ramp green→amber→red, numeric readout, low pulse
    this.healthFill.style.width = `${f * 100}%`;
    const hue = f * 115; // 0 = red, 115 = green
    this.healthFill.style.background = `hsl(${hue}, 70%, 45%)`;
    this.healthNum.textContent = String(Math.round(f * 100));
    this.healthEl.classList.toggle('low', f > 0 && f < 0.3);
  }

  // stamina bar: visible only while not full, so it never clutters the HUD
  setStamina(frac) {
    const f = Math.max(0, Math.min(1, frac));
    this.staminaFill.style.width = `${f * 100}%`;
    this.staminaEl.classList.toggle('visible', f < 0.995);
    this.staminaEl.classList.toggle('spent', f < 0.25);
  }

  // proximity/danger rim vignette, 0..1 (pulses via CSS when high)
  setDanger(level) {
    const l = Math.max(0, Math.min(1, level));
    this.dangerEl.style.opacity = String(l * 0.85);
    this.dangerEl.classList.toggle('high', l > 0.7);
  }

  showLoading() {
    this.loadingTip.textContent = this._loadingTips[Math.floor(Math.random() * this._loadingTips.length)];
    this.loadingEl.classList.add('visible');
  }

  hideLoading() {
    this.loadingEl.classList.remove('visible');
  }

  damageFlash(color = 'rgba(255,0,0,1)') {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = '0.5';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.flashEl.style.transition = 'opacity 0.6s ease';
      this.flashEl.style.opacity = '0';
    }));
  }

  fadeTo(opacity, seconds = 1) {
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.opacity = String(opacity);
  }

  // ---- hotbar -----------------------------------------------------
  renderHotbar(slots, selected) {
    const selectionChanged = selected !== this._lastSelectedSlot;
    this._lastSelectedSlot = selected;

    for (let i = 0; i < 6; i++) {
      const s = this.slotEls[i];
      const item = slots[i];
      s.root.classList.toggle('selected', i === selected);
      if (selectionChanged && i === selected) this._retrigger(s.root, 'bump');

      if (!item) {
        s.icon.textContent = '';
        s.count.style.display = 'none';
        s.meter.style.display = 'none';
        s.root.classList.remove('filled', 'low-battery');
        this._prevSlotSig[i] = null;
        continue;
      }

      // detect a pickup / restock (new item in this slot, or its count went
      // up) vs. a routine re-render (e.g. the flashlight's meter draining
      // every frame) so the pickup flash only plays when something changed.
      const prev = this._prevSlotSig[i];
      const gained = !prev || prev.name !== item.name || item.count > prev.count;
      this._prevSlotSig[i] = { name: item.name, count: item.count };
      if (gained) this._retrigger(s.icon, 'pickup');

      s.root.classList.add('filled');
      s.icon.textContent = item.icon;
      if (item.count > 1) {
        s.count.textContent = `×${item.count}`;
        s.count.style.display = 'block';
      } else {
        s.count.style.display = 'none';
      }

      if (item.meter != null) {
        s.meter.style.display = 'block';
        s.fill.style.width = `${Math.round(item.meter * 100)}%`;
        s.root.classList.toggle('low-battery', item.meter <= 0.2);
      } else {
        s.meter.style.display = 'none';
        s.root.classList.remove('low-battery');
      }
    }

    const sel = slots[selected];
    this.hotbarHint.textContent = sel ? `${sel.name.toUpperCase()} — press F or click to use` : '';
    this.hotbarHint.classList.toggle('visible', !!sel);
  }

  // ---- jumpscare face ----------------------------------------------
  // Procedurally paints a killer's face into a 512² canvas from FACE_STYLES.
  // `jitter` (default true) adds the twitchy per-eye randomness that suits a
  // jumpscare; the death portrait passes false for a stiller, poster look.
  _drawFace(ctx, kind, jitter = true) {
    const w = 512, h = 512;
    const st = FACE_STYLES[skinKey(kind)];
    const rnd = (a) => (jitter ? Math.random() * a : a * 0.5);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // glow
    const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 260);
    g.addColorStop(0, st.glow);
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // spider legs radiate from behind the head (drawn first so head overlaps)
    if (st.spider) {
      ctx.strokeStyle = st.skin;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const ay = h / 2 - 70 + i * 55;
          const knee = 150 + i * 12;
          ctx.beginPath();
          ctx.moveTo(w / 2, h / 2);
          ctx.lineTo(w / 2 + sx * knee, ay - 40);
          ctx.lineTo(w / 2 + sx * (knee + 70), ay + 30 + i * 18);
          ctx.stroke();
        }
      }
    }

    // head — spider gets a small round abdomen, everyone else a tall skull
    ctx.fillStyle = st.skin;
    ctx.beginPath();
    if (st.spider) ctx.ellipse(w / 2, h / 2, 130, 150, 0, 0, 7);
    else ctx.ellipse(w / 2, h / 2, st.wide ? 210 : 190, 225, 0, 0, 7);
    ctx.fill();

    // seek weeps black-then-glow goop down from the head
    if (st.goop) {
      ctx.fillStyle = st.skin;
      for (let i = 0; i < 7; i++) {
        const x = w / 2 - 150 + i * 50 + rnd(20);
        const len = 120 + rnd(150);
        ctx.beginPath();
        ctx.moveTo(x - 16, h / 2 + 120);
        ctx.quadraticCurveTo(x, h / 2 + 120 + len, x + 4, h / 2 + 150 + len);
        ctx.quadraticCurveTo(x + 8, h / 2 + 120 + len, x + 16, h / 2 + 120);
        ctx.fill();
      }
    }

    // eyes
    ctx.fillStyle = st.eye;
    if (st.eyes === 1) {
      // one vast central eye (Seek)
      const eg = ctx.createRadialGradient(w / 2, h / 2 - 10, 10, w / 2, h / 2 - 10, 120);
      eg.addColorStop(0, '#fff');
      eg.addColorStop(0.6, st.eye);
      eg.addColorStop(1, '#3a2a3a');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 - 10, 115, 115, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(w / 2 + rnd(24) - 12, h / 2 - 10 + rnd(24) - 12, 42, 42, 0, 0, 7);
      ctx.fill();
    } else if (st.eyes === 2) {
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + sx * 78, h / 2 - 48, 46 + rnd(10), 60 + rnd(12), sx * 0.2, 0, 7);
        ctx.fill();
      }
    } else if (st.eyes > 2) {
      // scattered swarm — clustered tightly for the spider, spread for Eyes/Void
      const spread = st.spider ? 90 : 240;
      const cy = st.spider ? h / 2 - 30 : h / 2 - 90;
      const size = st.spider ? 10 : 14;
      for (let i = 0; i < st.eyes; i++) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + (Math.random() - 0.5) * spread, cy + rnd(st.spider ? 80 : 160),
          size + rnd(st.spider ? 8 : 26), size + rnd(st.spider ? 10 : 30), 0, 0, 7);
        ctx.fill();
      }
    }

    // pupils for the paired-eye faces (jack's are already black)
    if (st.eyes === 2 && kind !== 'jack') {
      ctx.fillStyle = '#000';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + sx * 78, h / 2 - 44, 12, 18, 0, 0, 7);
        ctx.fill();
      }
    }

    // mouth
    if (st.mouth) {
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 + 105, 110, 60, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = st.eye;
      for (let i = 0; i < 12; i++) {
        const x = w / 2 - 100 + i * 18;
        ctx.beginPath();
        ctx.moveTo(x, h / 2 + 62);
        ctx.lineTo(x + 9, h / 2 + 62 + 26 + rnd(18));
        ctx.lineTo(x + 18, h / 2 + 62);
        ctx.fill();
      }
    }
  }

  scare(kind, dur = 0.55) {
    this._drawFace(this.scareCanvas.getContext('2d'), kind, true);
    this.scareEl.style.display = 'flex';
    this._retrigger(this.scareEl, 'scare-hit');
    clearTimeout(this._scareTimer);
    this._scareTimer = setTimeout(() => { this.scareEl.style.display = 'none'; }, dur * 1000);
  }

  // ---- screens -----------------------------------------------------
  _hideAllScreens() {
    for (const s of [this.menuEl, this.deathEl, this.winEl, this.pauseEl]) {
      s.classList.remove('visible');
    }
    this.menuBackdrop.classList.remove('visible');
  }
  hideScreens() { this._hideAllScreens(); }

  showMenu({ knobs, best, saveCode }) {
    this._hideAllScreens();
    this.menuStats.textContent =
      `Knobs: ${knobs}` + (best > 0 ? `   ·   Deepest run: Door ${best}` : '');
    if (saveCode) this.setSaveCode(saveCode);
    this.saveCodeMsg.textContent = '';
    this.menuEl.classList.add('visible');
    this.menuBackdrop.classList.add('visible');
    // replay the entrance animation every time the menu reopens (e.g. after
    // a death/win, not just on first load)
    const reveals = this.menuEl.querySelectorAll('.reveal');
    reveals.forEach((elm) => elm.classList.remove('reveal-play'));
    void this.menuEl.offsetWidth; // force reflow so the removed class registers before re-adding
    reveals.forEach((elm) => elm.classList.add('reveal-play'));
  }

  setSaveCode(code) { this.saveCodeInput.value = code; }
  saveCodeMessage(text, isError) {
    this.saveCodeMsg.textContent = text;
    this.saveCodeMsg.style.color = isError ? 'var(--blood)' : '#7ed07e';
  }

  showDeath({ killer, tip, quote, knobs, door }) {
    this._hideAllScreens();
    this.deathTitle.textContent = killer ? `${killer.toUpperCase()} GOT YOU` : 'YOU DIED';
    this._reveal(this.deathQuote, quote || '');
    this.deathTip.textContent = tip || '';
    this.deathKnobs.textContent = knobs > 0 ? `+${knobs} knobs` : '';
    this.deathStats.textContent = `You made it to Door ${door}.`;
    this.deathEl.classList.add('visible');
  }

  // Guiding-Light-style letter-by-letter reveal into `elm`. Any new call
  // cancels the previous reveal on the same element.
  _reveal(elm, text, cps = 28) {
    if (elm._revealTimer) clearInterval(elm._revealTimer);
    elm.textContent = '';
    if (!text) return;
    let i = 0;
    elm._revealTimer = setInterval(() => {
      i++;
      elm.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(elm._revealTimer); elm._revealTimer = null; }
    }, 1000 / cps);
  }

  // In-game Guiding Light narration: a gold letter-reveal line that sits
  // above the caption area and fades itself out after `hold` seconds.
  narrate(text, hold = 4.5) {
    this._reveal(this.narrateEl, text);
    this.narrateEl.classList.add('visible');
    clearTimeout(this._narrateTimeout);
    this._narrateTimeout = setTimeout(() => {
      this.narrateEl.classList.remove('visible');
    }, hold * 1000 + (text.length / 28) * 1000);
  }

  showWin({ knobs, gold }) {
    this._hideAllScreens();
    this.winKnobs.textContent = `+${knobs} knobs`;
    this.winStats.textContent = `Gold carried out: ${gold}`;
    this.winEl.classList.add('visible');
  }

  showPause() {
    this._hideAllScreens();
    this.pauseEl.classList.add('visible');
  }

  // hide gameplay chrome on menu, show in game
  setGameplayVisible(v) {
    const d = v ? '' : 'none';
    this.roomLabel.style.display = d;
    this.currency.style.display = d;
    this.crosshair.style.display = d;
    this.healthEl.style.display = v ? 'flex' : 'none';
    this.hotbarEl.style.display = v ? 'flex' : 'none';
    if (!v) {
      this.prompt(null);
      this.bigWarning(null);
      this.objective(null);
    }
  }
}
