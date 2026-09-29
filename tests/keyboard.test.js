// Opens TINYPAD and types mixed Latin/Cyrillic text through kkeys.js; check
// tests/shots/keyboard.png by eye (the guest layout must switch by itself).
const h = require("./harness"), M = require("../web/kmouse"), K = require("../web/kkeys");

(async () => {
  const e = await h.start();
  await h.sleep(40000);
  const p = M.pointer(e, () => [1024, 768]);
  p.sync(34, 93); p.click(0); await h.sleep(150); p.click(0); // TINYPAD icon
  await h.sleep(5000);
  const k = K.create(e);
  await k.text("Hello a1я2b3ю4c5 Привет, мир! ёЁ\n");
  await k.text("EN: ~`!@#$%^&*()_+-=[]{};':\"\\|,.<>/?\n");
  await k.text("RU: \"№;%:?.,Съешь же ещё этих мягких булок.\n");
  await h.sleep(1500);
  h.shot(e, "keyboard");
  console.log("see tests/shots/keyboard.png");
  process.exit(0);
})();
