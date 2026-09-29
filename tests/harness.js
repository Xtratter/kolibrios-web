// Headless KolibriOS test harness: boots v86 in node, exposes helpers, dumps screenshots.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const W = (process.env.KOLIBRI_WEB || path.join(__dirname, "..", "web")) + "/";
const OUT = path.join(__dirname, "shots");
const { V86 } = require(W + "libv86.js");
fs.mkdirSync(OUT, { recursive: true });

function png(file, w, h, rgba) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

function start(opts = {}) {
  const e = new V86({
    wasm_path: W + "v86.wasm",
    memory_size: 128 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    bios: { url: W + "seabios.bin" },
    vga_bios: { url: W + "vgabios.bin" },
    fda: { url: opts.fda || W + JSON.parse(fs.readFileSync(W + "os/current.json")).img },
    ...(opts.cdrom ? { cdrom: { url: opts.cdrom } } : {}),
    ...(opts.hda ? { hda: { url: opts.hda } } : {}),
    ...(opts.boot_order ? { boot_order: opts.boot_order } : {}),
    autostart: true,
  });
  return new Promise(r => e.add_listener("emulator-ready", () => r(e)));
}

// Returns {w,h,rgba} of the current graphics framebuffer (32bpp VBE), or null in text mode.
function frame(e) {
  const vga = e.v86.cpu.devices.vga;
  if (!vga.svga_enabled) return null;
  const w = vga.svga_width, h = vga.svga_height, bpp = vga.svga_bpp;
  const mem = vga.svga_memory, out = new Uint8Array(w * h * 4);
  const off = vga.svga_offset || 0;
  for (let i = 0; i < w * h; i++) {
    if (bpp === 32 || bpp === 24) { const s = off + i * (bpp / 8); out[i*4] = mem[s+2]; out[i*4+1] = mem[s+1]; out[i*4+2] = mem[s]; }
    out[i*4+3] = 255;
  }
  return { w, h, bpp, rgba: out };
}

function shot(e, name) {
  const f = frame(e);
  if (!f) { const t = textScreen(e); fs.writeFileSync(path.join(OUT, name + ".txt"), t); return null; }
  png(path.join(OUT, name + ".png"), f.w, f.h, f.rgba);
  return f;
}

function textScreen(e) {
  const vga = e.v86.cpu.devices.vga, m = vga.vga_memory;
  let s = "";
  for (let r = 0; r < 25; r++) { for (let c = 0; c < 80; c++) s += String.fromCharCode(m[0x18000 + (r * 80 + c) * 2] || 32); s += "\n"; }
  return s;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { start, shot, frame, sleep, png, textScreen };
