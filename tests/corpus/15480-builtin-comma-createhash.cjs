// TypeScript's CommonJS emit calls a module member through a comma indirection:
// (0, crypto_1.createHash)(...) drops the receiver. Node's crypto functions take none.
const crypto_1 = require("crypto");
const hex = (0, crypto_1.createHash)("sha1").update("x").digest("hex");
console.log(hex);
const b64 = (0, crypto_1.createHash)("sha256").update("scriptc").digest("base64");
console.log(b64);
console.log((0, crypto_1.createHash)("md5").update("").digest("hex"));
