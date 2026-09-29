// Boots KolibriOS and checks that the pointer lands on exact pixels, both after
// sync() (park in the corner and walk) and after relative moveTo().
const h = require("./harness"), M = require("../web/kmouse");

// Top-left of pixels that differ between two frames inside a box.
function changedAt(a, b, w, x0, y0, x1, y1) {
  for (let y = Math.max(0, y0); y < y1; y++)
    for (let x = Math.max(0, x0); x < x1; x++) {
      const i = (y * w + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return [x, y];
    }
  return null;
}

(async () => {
  const e = await h.start();
  await h.sleep(40000); // boot to desktop
  const p = M.pointer(e, () => [1024, 768]);
  p.sync(300, 300);
  let failed = 0;
  for (const [x, y] of [[310, 305], [600, 420], [598, 421], [100, 650], [1023, 0], [37, 30], [433, 217]]) {
    p.moveTo(x, y); await p.idle(); await h.sleep(600);
    const A = h.frame(e).rgba.slice();
    p.moveTo(x > 500 ? 200 : 800, 400); await p.idle(); await h.sleep(600);
    const got = changedAt(A, h.frame(e).rgba, 1024, x - 30, y - 30, x + 30, y + 30);
    const ok = got && got[0] === x && got[1] === y;
    if (!ok) failed++;
    console.log(ok ? "ok  " : "FAIL", `target ${x},${y}`, got ? `cursor ${got}` : "cursor not found");
  }
  process.exit(failed ? 1 : 0);
})();
