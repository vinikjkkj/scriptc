// (0, tls_1.connect)(options) against a closed local port: a deterministic
// ECONNREFUSED, with no network and no certificate needed.
const tls_1 = require("tls");
const sock = (0, tls_1.connect)({ port: 1, host: "127.0.0.1" });
sock.on("error", function (e) { console.log("error " + e.code); });
console.log("connecting");
