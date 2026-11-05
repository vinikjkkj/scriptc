"use strict";
// A refused dial to `localhost` (no host argument, then the name spelled out) reports ECONNREFUSED on every platform. On Windows the
// socket error arrives as a Winsock code that has to go through libuv's translation table (uv_translate_sys_error) to get its Node name.
const Net = require("net");
const out = [];
function dial(label, make, next) {
  const s = make();
  s.on("error", (e) => out.push(label + ":" + e.code));
  s.on("close", () => { out.push(label + ":close"); next(); });
}
dial("default-host", () => Net.connect(1), () => {
  dial("localhost", () => Net.connect(1, "localhost"), () => {
    dial("loopback", () => Net.connect(1, "127.0.0.1"), () => console.log(out.join("|")));
  });
});
