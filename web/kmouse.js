// Absolute pointer positioning for KolibriOS over a relative PS/2 mouse.
// The kernel (hid/mousedrv.inc, mouse_acceleration) turns a packet delta d into
// ((|d| + delay)^2 - 1) >> speed_shift) + 1 pixels, with defaults delay=3, speed=4
// (/sys/settings/system.ini [mouse]). Each v86 "mouse-delta" becomes its own
// packet, so the cursor can be parked in the corner and walked to an exact pixel.
(function (root) {
  const DELAY = 3, SHIFT = 4, MAX = 200; // |d| + delay must fit in a byte

  const accel = d => ((((d + DELAY) * (d + DELAY) - 1) & 0xffff) >> SHIFT) + 1;
  const TABLE = [];
  for (let d = 1; d <= MAX; d++) TABLE.push([d, accel(d)]);

  // Split a pixel distance into packet deltas whose accelerated sum is exact.
  function steps(px) {
    const out = [];
    for (let i = TABLE.length - 1; px > 0; ) {
      while (TABLE[i][1] > px) i--;
      out.push(TABLE[i][0]);
      px -= TABLE[i][1];
    }
    return out;
  }

  // Send deltas moving the cursor by exactly (dx, dy) screen pixels. PS/2 y grows upwards.
  function moveBy(bus, dx, dy) {
    const sx = steps(Math.abs(dx)), sy = steps(Math.abs(dy));
    for (let i = 0; i < Math.max(sx.length, sy.length); i++)
      bus.send("mouse-delta", [Math.sign(dx) * (sx[i] || 0), -Math.sign(dy) * (sy[i] || 0)]);
  }

  // Move the guest cursor to screen pixel (x, y) regardless of where it is.
  function warp(emulator, x, y) {
    for (let i = 0; i < 2; i++) emulator.bus.send("mouse-delta", [-MAX, MAX]);
    moveBy(emulator.bus, Math.max(0, Math.round(x)), Math.max(0, Math.round(y)));
  }

  // Tracks the cursor so later moves can be relative (no jump to the corner),
  // which keeps drags and double clicks intact. Call sync() to re-anchor.
  // Events are queued: KolibriOS programs poll the button state, so a press and
  // its release must be some time apart to be seen at all.
  const BUTTON_MS = 50;
  function pointer(emulator, screenSize) {
    let pos = null, buttons = [false, false, false], chain = Promise.resolve();
    const later = (fn, ms = 0) => (chain = chain.then(() => { fn(); if (ms) return new Promise(r => setTimeout(r, ms)); }));
    const clamp = (x, y) => {
      const [w, h] = screenSize();
      return [Math.min(Math.max(0, Math.round(x)), w - 1), Math.min(Math.max(0, Math.round(y)), h - 1)];
    };
    const sendButtons = b => later(() => emulator.bus.send("mouse-click", b), BUTTON_MS);
    return {
      sync(x, y) { [x, y] = clamp(x, y); later(() => warp(emulator, x, y)); pos = [x, y]; },
      moveTo(x, y) {
        if (!pos) return this.sync(x, y);
        [x, y] = clamp(x, y);
        const dx = x - pos[0], dy = y - pos[1];
        if (dx || dy) later(() => moveBy(emulator.bus, dx, dy));
        pos = [x, y];
      },
      button(i, down) { buttons[i] = down; sendButtons(buttons.slice()); },
      click(i = 0) { this.button(i, true); this.button(i, false); },
      releaseAll() { if (buttons.some(Boolean)) { buttons = [false, false, false]; sendButtons(buttons.slice()); } },
      wheel(dy) { later(() => emulator.bus.send("mouse-wheel", [dy, 0])); },
      invalidate() { pos = null; },
      idle() { return chain; },
      get pos() { return pos; },
    };
  }

  root.KMouse = { warp, steps, accel, pointer };
  if (typeof module !== "undefined") module.exports = root.KMouse;
})(typeof window !== "undefined" ? window : globalThis);
