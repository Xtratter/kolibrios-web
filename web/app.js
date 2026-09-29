"use strict";
// KolibriOS in the browser: emulator setup, touch/mouse input, soft keyboard,
// saved states. Input helpers live in kmouse.js and kkeys.js.

const $ = id => document.getElementById(id);
const status = $("status");
const container = $("screen_container");
const canvas = container.querySelector("canvas");
const isTouch = matchMedia("(pointer: coarse)").matches;

const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const setStatus = (text, sticky) => {
  status.textContent = text;
  clearTimeout(setStatus.t);
  if (!sticky && text) setStatus.t = setTimeout(() => (status.textContent = ""), 4000);
};
const mb = n => (n / 1048576).toFixed(1) + " МБ";

// ---------------------------------------------------------------- config

// A pending restore (state saved with another build or media setting) reloads
// the page with that configuration; sessionStorage carries it across.
let pending = null;
try { pending = JSON.parse(sessionStorage.getItem("kolibri-pending") || "null"); sessionStorage.removeItem("kolibri-pending"); } catch {}

async function loadConfig() {
  const latest = await fetch("os/current.json", { cache: "no-cache" }).then(r => r.json());
  let build = latest;
  if (pending && pending.build && pending.build !== latest.build) {
    build = await fetch(`os/${encodeURIComponent(pending.build)}/meta.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!build) { pending = null; build = latest; setStatus("Сборка сохранения больше недоступна", true); }
  }
  const media = pending ? !!pending.media : store.get("kolibri-media", false);
  return { build, latest, media };
}

// ---------------------------------------------------------------- emulator

let emulator, cfg, keys, ptr;

async function boot() {
  try { cfg = await loadConfig(); }
  catch (e) { setStatus("Не удалось получить описание сборки", true); throw e; }

  $("version").textContent = cfg.build.build.replace(/-[0-9a-f]{7}$/, "");
  $("version").title = `KolibriOS ${cfg.build.build} от ${cfg.build.date}`;
  $("opt-media").checked = cfg.media;
  $("media-size").textContent = mb(cfg.build.media_size).replace(".0", "");
  $("build-info").textContent = `${cfg.build.build}, сборка от ${cfg.build.date}`;

  emulator = new V86({
    wasm_path: "v86.wasm",
    memory_size: 128 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    screen: { container, use_graphical_text: true },
    bios: { url: "seabios.bin" },
    vga_bios: { url: "vgabios.bin" },
    fda: { url: cfg.build.img },
    // Media package: FAT32 disk with /kolibrios, read on demand via HTTP ranges.
    ...(cfg.media ? { hda: { url: cfg.build.media, async: true, size: cfg.build.media_size } } : {}),
    disable_mouse: true, // replaced by the absolute pointer below
    autostart: true,
  });

  let ready = false;
  emulator.add_listener("download-progress", e => {
    if (!ready && e.lengthComputable) setStatus("Загрузка " + Math.min(100, Math.round(e.loaded / e.total * 100)) + "%", true);
    else if (ready && cfg.media) setStatus("Чтение медиа-диска…");
  });
  emulator.add_listener("download-error", () => setStatus("Ошибка загрузки файлов", true));
  emulator.add_listener("emulator-ready", async () => {
    ready = true;
    setStatus(cfg.media ? "Медиа-пакет подключён" : "");
    if (pending && pending.restore) await restorePending();
  });
  emulator.add_listener("screen-set-size", () => requestAnimationFrame(fit));

  ptr = KMouse.pointer(emulator, () => [canvas.width || 1024, canvas.height || 768]);
  keys = KKeys.create(emulator, keyDelay);
  measureSpeed();

  // The boot loader uploads a Cyrillic font while its menu is already on
  // screen; v86 keeps rows drawn with the half-loaded font. While in text
  // mode, re-read the font and redraw everything now and then.
  setInterval(() => {
    const vga = emulator.v86 && emulator.v86.cpu.devices.vga;
    if (vga && !vga.graphical_mode) { vga.set_font_bitmap(true); vga.complete_redraw(); }
  }, 700);
}

// Console programs lose keys typed faster than ~100ms apart; slower devices
// run the guest slower, so stretch the delay by the emulator's peak speed.
let peakIps = 0;
function measureSpeed() {
  let last = emulator.get_instruction_counter(), t = performance.now();
  setInterval(() => {
    const c = emulator.get_instruction_counter(), now = performance.now();
    const ips = ((c - last) >>> 0) / (now - t) * 1000;
    if (ips > peakIps) peakIps = ips;
    last = c; t = now;
  }, 1000);
}
const keyDelay = () => (peakIps < 1e6 ? 150 : Math.round(100 * Math.min(4, Math.max(1, 100e6 / peakIps))));

// ---------------------------------------------------------------- screen fit

function fit() {
  const stage = $("stage");
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  const s = Math.min(stage.clientWidth / w, stage.clientHeight / h);
  container.style.setProperty("--cw", Math.floor(w * s) + "px");
  container.style.setProperty("--ch", Math.floor(h * s) + "px");
  container.classList.toggle("crisp", s >= 1);
}
new ResizeObserver(fit).observe($("stage"));
visualViewport && visualViewport.addEventListener("resize", fit);

// Guest pixel under a client coordinate.
function guestXY(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return [(clientX - r.left) / r.width * canvas.width, (clientY - r.top) / r.height * canvas.height];
}
const graphical = () => emulator && emulator.v86 && emulator.v86.cpu.devices.vga.svga_enabled;

// ---------------------------------------------------------------- mouse (desktop)

container.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || !graphical()) return;
  ptr.moveTo(...guestXY(e.clientX, e.clientY));
});
container.addEventListener("pointerenter", e => {
  if (e.pointerType === "mouse" && graphical()) ptr.sync(...guestXY(e.clientX, e.clientY));
});
container.addEventListener("pointerdown", e => {
  if (e.pointerType !== "mouse" || !graphical()) return;
  e.preventDefault();
  container.setPointerCapture(e.pointerId);
  ptr.moveTo(...guestXY(e.clientX, e.clientY));
  ptr.button([0, 1, 2][e.button] ?? 0, true);
});
container.addEventListener("pointerup", e => {
  if (e.pointerType !== "mouse" || !emulator) return;
  ptr.button([0, 1, 2][e.button] ?? 0, false);
});
container.addEventListener("wheel", e => {
  if (!emulator) return;
  e.preventDefault();
  ptr.wheel(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
container.addEventListener("contextmenu", e => e.preventDefault());

// ---------------------------------------------------------------- touch

// One finger: tap = click, long press = right click, drag = hold left button.
// Two fingers: vertical slide = wheel, tap = right click.
const touch = { pts: new Map(), mode: null, timer: 0, lastTap: null, lastEnd: 0, wheelAcc: 0 };
const LONG_MS = 550, SLOP = 10;

function touchPoint(e) { return { x: e.clientX, y: e.clientY, t: performance.now() }; }

container.addEventListener("touchstart", e => e.preventDefault(), { passive: false }); // keep soft keyboard focus

container.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" || !graphical() || pad.on) return;
  e.preventDefault();
  container.setPointerCapture(e.pointerId);
  const p = touchPoint(e);
  touch.pts.set(e.pointerId, { start: p, cur: p });

  if (touch.pts.size === 1) {
    touch.mode = "pending";
    let [gx, gy] = guestXY(p.x, p.y);
    const lt = touch.lastTap;
    // Second tap of a double tap: click exactly where the first one did.
    if (lt && p.t - lt.t < 500 && Math.hypot(p.x - lt.x, p.y - lt.y) < 24) [gx, gy] = lt.g;
    // Re-anchor after a pause in case the guest cursor was moved otherwise.
    if (p.t - touch.lastEnd > 3000 || !ptr.pos) ptr.sync(gx, gy); else ptr.moveTo(gx, gy);
    touch.g = [gx, gy];
    clearTimeout(touch.timer);
    touch.timer = setTimeout(() => {
      if (touch.mode !== "pending") return;
      touch.mode = "done";
      ptr.click(2);
      navigator.vibrate && navigator.vibrate(20);
    }, LONG_MS);
  } else if (touch.pts.size === 2) {
    clearTimeout(touch.timer);
    if (touch.mode === "drag") ptr.releaseAll();
    touch.mode = "two";
    touch.twoMoved = false;
    touch.wheelAcc = 0;
  }
});

container.addEventListener("pointermove", e => {
  if (e.pointerType === "mouse") return;
  const t = touch.pts.get(e.pointerId);
  if (!t) return;
  const prev = t.cur;
  t.cur = touchPoint(e);

  if (touch.mode === "pending" && Math.hypot(t.cur.x - t.start.x, t.cur.y - t.start.y) > SLOP) {
    clearTimeout(touch.timer);
    touch.mode = "drag";
    ptr.button(0, true);
  }
  if (touch.mode === "drag") ptr.moveTo(...guestXY(t.cur.x, t.cur.y));
  if (touch.mode === "two") {
    touch.wheelAcc += (t.cur.y - prev.y) / 2; // two fingers each report half
    if (Math.abs(touch.wheelAcc) > 6) touch.twoMoved = true;
    while (Math.abs(touch.wheelAcc) >= 24) {
      const dir = Math.sign(touch.wheelAcc);
      ptr.wheel(dir); // fingers down -> content up, like a touchpad
      touch.wheelAcc -= dir * 24;
    }
  }
});

function touchEnd(e) {
  if (e.pointerType === "mouse" || !touch.pts.has(e.pointerId)) return;
  const t = touch.pts.get(e.pointerId);
  touch.pts.delete(e.pointerId);
  clearTimeout(touch.timer);
  const now = performance.now();

  if (touch.mode === "pending" && e.type === "pointerup") {
    ptr.click(0);
    touch.lastTap = { x: t.start.x, y: t.start.y, t: now, g: touch.g };
  } else if (touch.mode === "drag") {
    ptr.button(0, false);
  } else if (touch.mode === "two" && touch.pts.size === 1 && !touch.twoMoved && now - t.start.t < 400) {
    ptr.click(2);
  }
  if (touch.pts.size === 0) { touch.mode = null; touch.lastEnd = now; }
  else if (touch.mode !== "two") touch.mode = "done";
}
container.addEventListener("pointerup", touchEnd);
container.addEventListener("pointercancel", touchEnd);

// ---------------------------------------------------------------- touchpad mode

// The whole area between the header and the bottom bars (the guest screen and
// the empty space around it) acts as a laptop touchpad: sliding moves the
// cursor from where it is (faster slides go further), tap = left click, two
// fingers = wheel, two-finger tap = right click. The bar below holds real
// buttons for dragging.
const stage = $("stage");
const pad = { on: false, pts: new Map(), moved: false, two: false, twoMoved: false, t0: 0, fx: 0, fy: 0, wheelAcc: 0 };

function setPad(on) {
  pad.on = on;
  store.set("kolibri-pad", on);
  document.body.classList.toggle("pad-on", on);
  $("btn-pad").setAttribute("aria-pressed", on);
  if (on && ptr && !ptr.pos && graphical()) ptr.sync(canvas.width / 2, canvas.height / 2);
  requestAnimationFrame(fit);
}
$("btn-pad").onclick = () => setPad(!pad.on);

stage.addEventListener("touchstart", e => { if (pad.on) e.preventDefault(); }, { passive: false });
stage.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" || !graphical() || !pad.on) return;
  e.preventDefault();
  stage.setPointerCapture(e.pointerId);
  const p = touchPoint(e);
  pad.pts.set(e.pointerId, { start: p, cur: p });
  if (pad.pts.size === 1) {
    Object.assign(pad, { moved: false, two: false, t0: p.t, fx: 0, fy: 0 });
    if (!ptr.pos) ptr.sync(canvas.width / 2, canvas.height / 2);
  } else if (pad.pts.size === 2) {
    Object.assign(pad, { two: true, twoMoved: false, wheelAcc: 0 });
  }
});

stage.addEventListener("pointermove", e => {
  const t = pad.on && pad.pts.get(e.pointerId);
  if (!t) return;
  const prev = t.cur;
  t.cur = touchPoint(e);
  const dx = t.cur.x - prev.x, dy = t.cur.y - prev.y;

  if (pad.two) {
    pad.wheelAcc += dy / 2;
    if (Math.abs(pad.wheelAcc) > 6) pad.twoMoved = true;
    while (Math.abs(pad.wheelAcc) >= 24) {
      const dir = Math.sign(pad.wheelAcc);
      ptr.wheel(dir);
      pad.wheelAcc -= dir * 24;
    }
    return;
  }
  if (!pad.moved && Math.hypot(t.cur.x - t.start.x, t.cur.y - t.start.y) <= SLOP) return; // still a tap
  pad.moved = true;
  // Guest pixels per CSS pixel: 0.9 for slow precise moves, up to 3.5 for flicks.
  const speed = Math.hypot(dx, dy) / Math.max(1, t.cur.t - prev.t);
  const gain = Math.min(3.5, 0.9 + speed * 1.2);
  pad.fx += dx * gain; pad.fy += dy * gain;
  const ix = Math.trunc(pad.fx), iy = Math.trunc(pad.fy);
  pad.fx -= ix; pad.fy -= iy;
  if ((ix || iy) && ptr.pos) ptr.moveTo(ptr.pos[0] + ix, ptr.pos[1] + iy);
});

function padEnd(e) {
  if (!pad.on || !pad.pts.has(e.pointerId)) return;
  pad.pts.delete(e.pointerId);
  if (pad.pts.size || e.type !== "pointerup") return;
  const quick = performance.now() - pad.t0 < 350;
  if (pad.two) { if (!pad.twoMoved && quick) ptr.click(2); }
  else if (!pad.moved && quick) ptr.click(0);
}
stage.addEventListener("pointerup", padEnd);
stage.addEventListener("pointercancel", padEnd);

// Mouse buttons bar: hold to keep a button down (drag with another finger).
for (const b of document.querySelectorAll("#mouse-bar [data-btn]")) {
  const i = +b.dataset.btn;
  const up = () => { if (b.classList.contains("down")) { b.classList.remove("down"); ptr && ptr.button(i, false); } };
  b.addEventListener("pointerdown", e => {
    e.preventDefault(); // keeps the soft keyboard open
    if (!ptr) return;
    b.setPointerCapture(e.pointerId);
    b.classList.add("down");
    ptr.button(i, true);
    navigator.vibrate && navigator.vibrate(10);
  });
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
}
$("btn-dbl").addEventListener("pointerdown", e => e.preventDefault());
$("btn-dbl").onclick = () => { if (ptr) { ptr.click(0); ptr.click(0); } };

// ---------------------------------------------------------------- soft keyboard

// A hidden textarea receives the Android keyboard. Its value is diffed on every
// input event, which also copes with predictive text rewriting whole words.
const ta = $("kbd");
const SENTINEL = "    ";
let prev = SENTINEL, composing = false;
const sticky = new Set();

function resetTa() { ta.value = prev = SENTINEL; ta.setSelectionRange(SENTINEL.length, SENTINEL.length); }
function takeMods() {
  const m = [...sticky].map(n => KKeys.MODS[n]);
  if (sticky.size) { sticky.clear(); renderSticky(); }
  return m;
}

ta.addEventListener("compositionstart", () => (composing = true));
ta.addEventListener("compositionend", () => { composing = false; if (ta.value.length > 64) resetTa(); });
ta.addEventListener("input", () => {
  if (!keys) return resetTa();
  const cur = ta.value;
  let p = 0;
  while (p < prev.length && p < cur.length && prev[p] === cur[p]) p++;
  const removed = prev.length - p, added = cur.slice(p);
  if (removed) keys.backspace(removed);
  if (added) keys.text(added.replace(/ /g, " "), takeMods());
  prev = cur;
  if (cur.length < SENTINEL.length || (!composing && cur.length > 64)) resetTa();
});

const NAMED_KEYS = {
  Escape: "Esc", Tab: "Tab", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Delete: "Del", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn", Insert: "Ins",
};
for (let i = 1; i <= 12; i++) NAMED_KEYS["F" + i] = "F" + i;

// Keys that produce no text (arrows, Esc, F-keys, Ctrl/Alt combos from a
// hardware keyboard) never reach the input event, so handle them here.
ta.addEventListener("keydown", e => {
  if (!keys || e.isComposing || e.keyCode === 229) return;
  const mods = [...(e.ctrlKey ? [KKeys.MODS.Ctrl] : []), ...(e.altKey ? [KKeys.MODS.Alt] : []), ...(e.shiftKey && NAMED_KEYS[e.key] ? [KKeys.MODS.Shift] : [])];
  if (NAMED_KEYS[e.key]) {
    e.preventDefault();
    keys.key(NAMED_KEYS[e.key], [...mods, ...takeMods()]);
  } else if ((e.ctrlKey || e.altKey) && e.key.length === 1) {
    e.preventDefault();
    keys.combo(e.key, [...mods, ...takeMods()]);
  }
});

function setKeyboard(on) {
  document.body.classList.toggle("kbd-on", on);
  $("btn-kbd").setAttribute("aria-pressed", on);
  if (on) { resetTa(); ta.focus({ preventScroll: true }); }
  else ta.blur();
  requestAnimationFrame(fit);
}
$("btn-kbd").addEventListener("pointerdown", e => e.preventDefault()); // don't steal focus
$("btn-kbd").onclick = () => {
  const on = document.body.classList.contains("kbd-on");
  if (on && document.activeElement !== ta) ta.focus({ preventScroll: true }); // reopen a dismissed keyboard
  else setKeyboard(!on);
};

// Extra keys bar: modifiers are one-shot (apply to the next key), others send at once.
function renderSticky() {
  for (const b of document.querySelectorAll("#keys [data-mod]")) b.setAttribute("aria-pressed", sticky.has(b.dataset.mod));
}
for (const b of document.querySelectorAll("#keys button")) {
  b.addEventListener("pointerdown", e => e.preventDefault());
  b.addEventListener("click", () => {
    if (!keys) return;
    if (b.dataset.mod) {
      sticky.has(b.dataset.mod) ? sticky.delete(b.dataset.mod) : sticky.add(b.dataset.mod);
      renderSticky();
    } else {
      keys.key(b.dataset.key, takeMods());
    }
  });
}

// ---------------------------------------------------------------- menu & actions

const menu = $("menu");
$("btn-menu").onclick = () => menu.showModal();
menu.addEventListener("click", e => { if (e.target === menu) menu.close(); });
$("menu-close").onclick = () => menu.close();

$("btn-full").onclick = async () => {
  try {
    if (document.fullscreenElement) return await document.exitFullscreen();
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    if (isTouch) await screen.orientation.lock("landscape").catch(() => {});
  } catch { setStatus("Полноэкранный режим недоступен"); }
};
document.addEventListener("fullscreenchange", () => requestAnimationFrame(fit));

$("act-cad").onclick = () => { menu.close(); keys && keys.key("Del", [KKeys.MODS.Ctrl, KKeys.MODS.Alt]); };
$("act-reset").onclick = () => { menu.close(); ptr && ptr.invalidate(); keys && keys.resetLayout(); emulator.restart(); };

$("opt-media").onchange = e => {
  store.set("kolibri-media", e.target.checked);
  $("media-note").hidden = false;
};
$("act-apply").onclick = () => location.reload();

// ---------------------------------------------------------------- saved states

// Record: { data: gzip(state), time, build, media }. A state only restores into
// the same build and disk set, so a mismatch reboots into the saved config first.
const STATE_KEY = "kolibri-state", PENDING_KEY = "kolibri-pending";
const FILE_MAGIC = "KOLIBRI-STATE\n";

async function gzip(buf) { return new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(); }
async function gunzip(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("kolibri", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("states");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("states", mode);
      const req = fn(tx.objectStore("states"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function run(label, fn) {
  menu.open && menu.close();
  setStatus(label + "…", true);
  try { setStatus(await fn()); }
  catch (e) { console.error(e); setStatus("Ошибка: " + (e.message || e), true); }
}

async function snapshot() {
  return { data: await gzip(await emulator.save_state()), time: Date.now(), build: cfg.build.build, media: cfg.media };
}

async function applyRecord(rec) {
  const build = rec.build || cfg.build.build, media = rec.media ?? false;
  if (build !== cfg.build.build || media !== cfg.media) {
    await idb("readwrite", s => s.put(rec, PENDING_KEY));
    sessionStorage.setItem("kolibri-pending", JSON.stringify({ build, media, restore: true }));
    location.reload();
    return "Перезапуск с нужной сборкой…";
  }
  await emulator.restore_state(await gunzip(rec.data));
  ptr.invalidate(); keys.resetLayout();
  emulator.run();
  return "Восстановлено от " + new Date(rec.time).toLocaleString("ru-RU");
}

async function restorePending() {
  await run("Восстановление", async () => {
    const rec = await idb("readonly", s => s.get(PENDING_KEY));
    if (!rec) return "Нечего восстанавливать";
    await idb("readwrite", s => s.delete(PENDING_KEY));
    return applyRecord(rec);
  });
}

$("act-save").onclick = () => run("Сохранение", async () => {
  const rec = await snapshot();
  await idb("readwrite", s => s.put(rec, STATE_KEY));
  return "Сохранено (" + mb(rec.data.byteLength) + ")";
});
$("act-load").onclick = () => run("Восстановление", async () => {
  const rec = await idb("readonly", s => s.get(STATE_KEY));
  if (!rec) return "Нет сохранения в этом браузере";
  return applyRecord(rec);
});
$("act-export").onclick = () => run("Подготовка файла", async () => {
  const rec = await snapshot();
  const head = new TextEncoder().encode(FILE_MAGIC + JSON.stringify({ time: rec.time, build: rec.build, media: rec.media }) + "\n");
  const file = await gzip(await new Blob([head, await gunzip(rec.data)]).arrayBuffer());
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([file], { type: "application/gzip" }));
  a.download = "kolibri-state-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".bin.gz";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return "Файл скачан (" + mb(file.byteLength) + ")";
});
const fileIn = $("file-in");
$("act-import").onclick = () => fileIn.click();
fileIn.onchange = () => {
  const f = fileIn.files[0];
  fileIn.value = "";
  if (!f) return;
  run("Загрузка файла", async () => {
    const raw = new Uint8Array(await gunzip(await f.arrayBuffer()));
    const magic = new TextEncoder().encode(FILE_MAGIC);
    let rec = { time: f.lastModified, build: cfg.build.build, media: cfg.media };
    let body = raw;
    if (magic.every((b, i) => raw[i] === b)) {
      const nl = raw.indexOf(10, magic.length);
      Object.assign(rec, JSON.parse(new TextDecoder().decode(raw.subarray(magic.length, nl))));
      body = raw.subarray(nl + 1);
    }
    rec.data = await gzip(body);
    return applyRecord(rec);
  });
};

// ---------------------------------------------------------------- start

if (isTouch) document.body.classList.add("touch");
boot().then(() => setPad(store.get("kolibri-pad", false)));
