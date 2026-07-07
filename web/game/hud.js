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

export class Hud {
  constructor(root) {
    this.root = root;
    this.on = {}; // callbacks injected by main
    this._toastTimer = null;
    this._captionTimer = null;
    this._build();
  }

  _build() {
    const r = this.root;

    // tints (bottom of the stack)
    el('div', { id: 'vignette', cls: 'fullscreen' }, r);
    this.hurt = el('div', { id: 'hurt-vignette', cls: 'fullscreen' }, r);
    this.flashEl = el('div', { id: 'flash', cls: 'fullscreen' }, r);

    // gameplay text
    this.roomLabel = el('div', { id: 'room-label', cls: 'hud-label', text: 'LOBBY' }, r);
    this.currency = el('div', { id: 'currency', cls: 'hud-label' }, r);
    this.goldEl = el('div', { cls: 'gold', text: 'Gold  0' }, this.currency);
    this.knobsEl = el('div', { cls: 'knobs', text: 'Knobs  0' }, this.currency);
    this.keysEl = el('div', { text: '' }, this.currency);
    this.crosshair = el('div', { id: 'crosshair' }, r);
    this.promptEl = el('div', { id: 'prompt' }, r);
    this.promptEl.style.display = 'none';
    this.objectiveEl = el('div', { id: 'objective', cls: 'hud-label' }, r);
    this.toastEl = el('div', { id: 'toast', cls: 'hud-label' }, r);
    this.captionEl = el('div', { id: 'caption' }, r);
    this.warnEl = el('div', { id: 'big-warning' }, r);

    // hotbar
    this.hotbarEl = el('div', { id: 'hotbar' }, r);
    this.slotEls = [];
    for (let i = 0; i < 5; i++) {
      const s = el('div', { cls: 'slot' }, this.hotbarEl);
      el('span', { cls: 'num', text: String(i + 1) }, s);
      const icon = el('span', { cls: 'icon' }, s);
      const meter = el('span', { cls: 'meter' }, s);
      const fill = el('i', {}, meter);
      meter.style.display = 'none';
      this.slotEls.push({ root: s, icon, meter, fill });
    }

    // jumpscare + fade (near top)
    this.scareEl = el('div', { id: 'scare' }, r);
    this.scareCanvas = el('canvas', {}, this.scareEl);
    this.scareCanvas.width = 512;
    this.scareCanvas.height = 512;
    this.fadeEl = el('div', { id: 'fade', cls: 'fullscreen' }, r);

    this._buildScreens();
    this._buildPadlock();
    this._buildPaper();
  }

  // ---------------------------------------------------------------
  _buildScreens() {
    const r = this.root;

    // MENU
    this.menuEl = el('div', { cls: 'screen', id: 'menu-screen' }, r);
    el('h1', { text: 'A HUNDRED DOORS' }, this.menuEl);
    el('div', { cls: 'sub', text: 'The elevator is broken. The only way out is through.' }, this.menuEl);
    this.menuStats = el('div', { cls: 'stats' }, this.menuEl);
    const playBtn = el('button', { cls: 'btn primary', text: 'ENTER THE HOTEL' }, this.menuEl);
    playBtn.addEventListener('click', () => this.on.play?.());
    el('div', {
      cls: 'controls-hint',
      html: '<b>WASD</b> move &nbsp;·&nbsp; <b>Mouse</b> look &nbsp;·&nbsp; <b>E</b> interact &nbsp;·&nbsp; ' +
            '<b>C / Ctrl</b> crouch &nbsp;·&nbsp; <b>1–5</b> items &nbsp;·&nbsp; <b>F</b> / click — use item &nbsp;·&nbsp; <b>Esc</b> pause' +
            '<br>When the lights flicker — <b>hide</b>. In darkness, when something whispers — <b>look at it</b>. ' +
            'If something watches from the middle of a room — <b>don\'t look</b>.',
    }, this.menuEl);
    // sliders
    const sliders = el('div', { cls: 'controls-hint' }, this.menuEl);
    sliders.style.pointerEvents = 'auto';
    const volLabel = el('label', { html: 'Volume ' }, sliders);
    this.volSlider = el('input', {}, volLabel);
    Object.assign(this.volSlider, { type: 'range', min: 0, max: 100, value: 80 });
    el('span', { html: ' &nbsp;&nbsp; ' }, sliders);
    const sensLabel = el('label', { html: 'Sensitivity ' }, sliders);
    this.sensSlider = el('input', {}, sensLabel);
    Object.assign(this.sensSlider, { type: 'range', min: 20, max: 200, value: 100 });

    // DEATH
    this.deathEl = el('div', { cls: 'screen' }, r);
    this.deathTitle = el('h2', { text: 'YOU DIED' }, this.deathEl);
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
  get modalOpen() { return this.padlockVisible || this.paperVisible; }

  // ---------------------------------------------------------------
  setRoom(n) {
    this.roomLabel.textContent = n <= 0 ? 'LOBBY' : `ROOM ${String(n).padStart(3, '0')}`;
  }
  setGold(n) { this.goldEl.textContent = `Gold  ${n}`; }
  setKnobs(n) { this.knobsEl.textContent = `Knobs  ${n}`; }
  setKeys(n) { this.keysEl.textContent = n > 0 ? `Keys  ${n}` : ''; }

  prompt(text) {
    if (!text) {
      this.promptEl.style.display = 'none';
      return;
    }
    this.promptEl.style.display = 'block';
    this.promptEl.innerHTML = `<span class="key">E</span>${text}`;
  }

  toast(text, color = null, dur = 3) {
    this.toastEl.textContent = text;
    this.toastEl.style.color = color || 'var(--parchment)';
    this.toastEl.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.style.opacity = '0'; }, dur * 1000);
  }

  caption(text, dur = 4) {
    this.captionEl.textContent = text;
    this.captionEl.style.opacity = '1';
    clearTimeout(this._captionTimer);
    this._captionTimer = setTimeout(() => { this.captionEl.style.opacity = '0'; }, dur * 1000);
  }

  bigWarning(text) {
    if (!text) {
      this.warnEl.style.display = 'none';
    } else {
      this.warnEl.textContent = text;
      this.warnEl.style.display = 'block';
    }
  }

  objective(text) {
    this.objectiveEl.textContent = text || '';
  }

  setHealth(frac) {
    this.hurt.style.opacity = String((1 - Math.max(0, frac)) * 0.9);
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
    for (let i = 0; i < 5; i++) {
      const s = this.slotEls[i];
      const item = slots[i];
      s.root.classList.toggle('selected', i === selected);
      if (!item) {
        s.icon.textContent = '';
        s.meter.style.display = 'none';
        continue;
      }
      s.icon.textContent = item.icon + (item.count > 1 ? ` ×${item.count}` : '');
      if (item.meter != null) {
        s.meter.style.display = 'block';
        s.fill.style.width = `${Math.round(item.meter * 100)}%`;
      } else {
        s.meter.style.display = 'none';
      }
    }
  }

  // ---- jumpscare face ----------------------------------------------
  scare(kind, dur = 0.55) {
    const ctx = this.scareCanvas.getContext('2d');
    const w = 512, h = 512;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const styles = {
      rush:    { skin: '#0a0a0d', eye: '#e8e8f2', mouth: true, eyes: 2, glow: '#334' },
      ambush:  { skin: '#08120a', eye: '#8dff9d', mouth: true, eyes: 3, glow: '#0f0' },
      screech: { skin: '#050505', eye: '#ffffff', mouth: true, eyes: 2, glow: '#222' },
      dupe:    { skin: '#120b08', eye: '#ffd27e', mouth: true, eyes: 2, glow: '#420' },
      jack:    { skin: '#dcdcdc', eye: '#111111', mouth: false, eyes: 2, glow: '#fff' },
      figure:  { skin: '#1a0d0d', eye: '#000000', mouth: true, eyes: 0, glow: '#400' },
      halt:    { skin: '#0a1420', eye: '#9fdcff', mouth: false, eyes: 2, glow: '#08f' },
      hide:    { skin: '#0d0d0d', eye: '#c8c8c8', mouth: false, eyes: 2, glow: '#333' },
      eyes:    { skin: '#1c0930', eye: '#e0c0ff', mouth: false, eyes: 8, glow: '#a4e' },
    };
    const st = styles[kind] || styles.rush;

    // glow
    const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 260);
    g.addColorStop(0, st.glow);
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // head
    ctx.fillStyle = st.skin;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 190, 225, 0, 0, 7);
    ctx.fill();
    // eyes
    ctx.fillStyle = st.eye;
    if (st.eyes === 2) {
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + sx * 78, h / 2 - 48, 46 + Math.random() * 10, 60 + Math.random() * 12, sx * 0.2, 0, 7);
        ctx.fill();
      }
    } else if (st.eyes > 2) {
      for (let i = 0; i < st.eyes; i++) {
        ctx.beginPath();
        ctx.ellipse(w / 2 + (Math.random() - 0.5) * 240, h / 2 - 90 + Math.random() * 160,
          14 + Math.random() * 26, 18 + Math.random() * 30, 0, 0, 7);
        ctx.fill();
      }
    }
    // pupils
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
        ctx.lineTo(x + 9, h / 2 + 62 + 26 + Math.random() * 18);
        ctx.lineTo(x + 18, h / 2 + 62);
        ctx.fill();
      }
    }

    this.scareEl.style.display = 'flex';
    setTimeout(() => { this.scareEl.style.display = 'none'; }, dur * 1000);
  }

  // ---- screens -----------------------------------------------------
  _hideAllScreens() {
    for (const s of [this.menuEl, this.deathEl, this.winEl, this.pauseEl]) {
      s.classList.remove('visible');
    }
  }
  hideScreens() { this._hideAllScreens(); }

  showMenu({ knobs, best }) {
    this._hideAllScreens();
    this.menuStats.textContent =
      `Knobs: ${knobs}` + (best > 0 ? `   ·   Deepest run: Door ${best}` : '');
    this.menuEl.classList.add('visible');
  }

  showDeath({ killer, tip, knobs, door }) {
    this._hideAllScreens();
    this.deathTitle.textContent = killer ? `${killer.toUpperCase()} GOT YOU` : 'YOU DIED';
    this.deathTip.textContent = tip || '';
    this.deathKnobs.textContent = knobs > 0 ? `+${knobs} knobs` : '';
    this.deathStats.textContent = `You made it to Door ${door}.`;
    this.deathEl.classList.add('visible');
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
    this.hotbarEl.style.display = v ? 'flex' : 'none';
    if (!v) {
      this.prompt(null);
      this.bigWarning(null);
      this.objective(null);
    }
  }
}
