// Text and special-key input for KolibriOS via PS/2 scancodes (set 1).
// Characters are typed as physical key presses, switching the guest layout when
// needed. @taskbar owns the layout: Alt+2 always selects Ru, while Ctrl+Shift
// toggles En/Ru from its own counter, so after it we check the "En"/"Ru"
// indicator it draws on the taskbar and press again if needed.
(function (root) {
  const SHIFT = 0x2A, CTRL = 0x1D, ALT = 0x38;

  // Unshifted/shifted characters per key, in physical key order.
  const KEYS = [
    // scancode, EN, EN+Shift, RU, RU+Shift
    [0x29, "`", "~", "ё", "Ё"],
    [0x02, "1", "!", "1", "!"], [0x03, "2", "@", "2", "\""], [0x04, "3", "#", "3", "№"],
    [0x05, "4", "$", "4", ";"], [0x06, "5", "%", "5", "%"], [0x07, "6", "^", "6", ":"],
    [0x08, "7", "&", "7", "?"], [0x09, "8", "*", "8", "*"], [0x0A, "9", "(", "9", "("],
    [0x0B, "0", ")", "0", ")"], [0x0C, "-", "_", "-", "_"], [0x0D, "=", "+", "=", "+"],
    [0x10, "q", "Q", "й", "Й"], [0x11, "w", "W", "ц", "Ц"], [0x12, "e", "E", "у", "У"],
    [0x13, "r", "R", "к", "К"], [0x14, "t", "T", "е", "Е"], [0x15, "y", "Y", "н", "Н"],
    [0x16, "u", "U", "г", "Г"], [0x17, "i", "I", "ш", "Ш"], [0x18, "o", "O", "щ", "Щ"],
    [0x19, "p", "P", "з", "З"], [0x1A, "[", "{", "х", "Х"], [0x1B, "]", "}", "ъ", "Ъ"],
    [0x1E, "a", "A", "ф", "Ф"], [0x1F, "s", "S", "ы", "Ы"], [0x20, "d", "D", "в", "В"],
    [0x21, "f", "F", "а", "А"], [0x22, "g", "G", "п", "П"], [0x23, "h", "H", "р", "Р"],
    [0x24, "j", "J", "о", "О"], [0x25, "k", "K", "л", "Л"], [0x26, "l", "L", "д", "Д"],
    [0x27, ";", ":", "ж", "Ж"], [0x28, "'", "\"", "э", "Э"], [0x2B, "\\", "|", "\\", "/"],
    [0x2C, "z", "Z", "я", "Я"], [0x2D, "x", "X", "ч", "Ч"], [0x2E, "c", "C", "с", "С"],
    [0x2F, "v", "V", "м", "М"], [0x30, "b", "B", "и", "И"], [0x31, "n", "N", "т", "Т"],
    [0x32, "m", "M", "ь", "Ь"], [0x33, ",", "<", "б", "Б"], [0x34, ".", ">", "ю", "Ю"],
    [0x35, "/", "?", ".", ","],
  ];
  const MAP = { en: new Map(), ru: new Map() };
  for (const [sc, e, E, r, R] of KEYS) {
    MAP.en.set(e, [sc, false]); MAP.en.set(E, [sc, true]);
    MAP.ru.set(r, [sc, false]); MAP.ru.set(R, [sc, true]);
  }
  // Layout-independent keys.
  const COMMON = new Map([[" ", 0x39], ["\n", 0x1C], ["\t", 0x0F]]);

  // Named keys for the on-screen bar; extended keys are prefixed with 0xE0.
  const NAMED = {
    Esc: [0x01], Tab: [0x0F], Enter: [0x1C], Backspace: [0x0E], Space: [0x39],
    Up: [0xE0, 0x48], Down: [0xE0, 0x50], Left: [0xE0, 0x4B], Right: [0xE0, 0x4D],
    Home: [0xE0, 0x47], End: [0xE0, 0x4F], PgUp: [0xE0, 0x49], PgDn: [0xE0, 0x51],
    Del: [0xE0, 0x53], Ins: [0xE0, 0x52], Win: [0xE0, 0x5B],
    F1: [0x3B], F2: [0x3C], F3: [0x3D], F4: [0x3E], F5: [0x3F], F6: [0x40],
    F7: [0x41], F8: [0x42], F9: [0x43], F10: [0x44], F11: [0x57], F12: [0x58],
  };
  const MODS = { Ctrl: CTRL, Alt: ALT, Shift: SHIFT };

  // White-pixel masks of the 12x7 taskbar indicator text.
  const INDICATOR = {
    en: ["#####.......", "#...........", "#.....#.##..", "####..##..#.", "#.....#...#.", "#.....#...#.", "#####.#...#."],
    ru: ["####........", "#...#.......", "#...#.#...#.", "####..#...#.", "#.#...#...#.", "#..#..#..##.", "#...#..##.#."],
  };

  // Reads the current layout from the taskbar indicator, or null if not found.
  function readIndicator(emulator) {
    const vga = emulator.v86 && emulator.v86.cpu.devices.vga;
    if (!vga || !vga.svga_enabled || vga.svga_bpp < 24) return null;
    const w = vga.svga_width, h = vga.svga_height, bpp = vga.svga_bpp / 8, mem = vga.svga_memory;
    const white = (x, y) => { const i = (y * w + x) * bpp; return mem[i] > 200 && mem[i + 1] > 200 && mem[i + 2] > 200; };
    for (let y = Math.max(0, h - 40); y < h - 7; y++)
      for (let x = Math.max(0, w - 400); x < w - 12; x++) {
        if (!white(x, y)) continue;
        for (const lay in INDICATOR) {
          const m = INDICATOR[lay];
          let ok = true;
          for (let r = 0; r < 7 && ok; r++) for (let c = 0; c < 12; c++) if ((m[r][c] === "#") !== white(x + c, y + r)) { ok = false; break; }
          if (ok) return lay;
        }
      }
    return null;
  }

  const press = codes => codes.length === 2 ? [codes[0], codes[1]] : [codes[0]];
  const release = codes => codes.length === 2 ? [codes[0], codes[1] | 0x80] : [codes[0] | 0x80];

  // delay: ms between scancodes, or a function returning it. Console programs
  // drop keys that arrive faster than ~100ms apart, editors cope with 25ms.
  function create(emulator, delay = 100) {
    const pause = () => (typeof delay === "function" ? delay() : delay);
    let layout = null, lastUse = 0; // cached guest layout; re-read after idle
    let queue = Promise.resolve();
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const send = async codes => { for (const c of codes) emulator.bus.send("keyboard-code", c); await sleep(pause()); };

    async function tap(codes, mods = []) {
      for (const m of mods) await send([m]);
      await send(press(codes));
      await send(release(codes));
      for (const m of [...mods].reverse()) await send([m | 0x80]);
    }
    async function setLayout(want) {
      const now = Date.now();
      if (layout === want && now - lastUse < 2000) return (lastUse = now);
      layout = readIndicator(emulator);
      // @taskbar handles hotkeys asynchronously; give each one time to land.
      if (layout !== want && want === "ru") { await tap([0x03], [ALT]); await sleep(350); layout = readIndicator(emulator); }
      for (let i = 0; i < 3 && layout !== want; i++) {
        await tap([SHIFT], [CTRL]);
        await sleep(350);
        layout = readIndicator(emulator);
        if (layout === null) break; // indicator not visible: trust the toggle
      }
      layout = want;
      lastUse = Date.now();
    }
    async function typeChar(ch, mods) {
      if (COMMON.has(ch)) return tap([COMMON.get(ch)], mods);
      let lay = layout && MAP[layout].has(ch) ? layout : MAP.en.has(ch) ? "en" : MAP.ru.has(ch) ? "ru" : null;
      if (!lay) return;
      await setLayout(lay);
      const [sc, shift] = MAP[lay].get(ch);
      await tap([sc], shift ? [SHIFT, ...mods] : mods);
    }
    const enqueue = fn => (queue = queue.then(fn).catch(console.error));

    return {
      text: (s, mods = []) => enqueue(async () => { for (const ch of s) await typeChar(ch, mods); }),
      key: (name, mods = []) => enqueue(() => tap(NAMED[name], mods)),
      combo: (name, mods) => enqueue(() => NAMED[name] ? tap(NAMED[name], mods) : typeChar(name.toLowerCase(), mods)),
      backspace: n => enqueue(async () => { for (let i = 0; i < n; i++) await tap(NAMED.Backspace); }),
      resetLayout: () => { layout = null; },
      get layout() { return layout; },
      MODS,
    };
  }

  root.KKeys = { create, NAMED, MODS, readIndicator };
  if (typeof module !== "undefined") module.exports = root.KKeys;
})(typeof window !== "undefined" ? window : globalThis);
