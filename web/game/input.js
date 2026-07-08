// input.js — keyboard state, edge-triggered presses, pointer lock mouse look.

export const Input = {
  keys: new Set(),
  presses: new Set(), // keys pressed since last endFrame()
  mouseDX: 0,
  mouseDY: 0,
  locked: false,
  wheelDelta: 0,
  _canvas: null,
  onLockChange: null,

  init(canvasEl) {
    this._canvas = canvasEl;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.presses.add(e.code);
      if (['Space', 'Tab', 'KeyE'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    window.addEventListener('wheel', (e) => {
      this.wheelDelta += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvasEl;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  },

  requestLock() {
    if (this._canvas && !this.locked) {
      this._canvas.requestPointerLock?.();
    }
  },

  exitLock() {
    if (this.locked) document.exitPointerLock?.();
  },

  down(code) { return this.keys.has(code); },
  pressed(code) { return this.presses.has(code); },

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  },

  consumeWheel() {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  },

  endFrame() {
    this.presses.clear();
  },
};
