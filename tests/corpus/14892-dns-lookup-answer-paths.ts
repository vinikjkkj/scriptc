// dns.lookup's answer on each path: address string on success, undefined on
// failure (with the ENOTFOUND error), family 4 or undefined. The address and
// family are narrowed before use, as the type says they must be.
import * as dns from "node:dns";

dns.lookup("127.0.0.1", { family: 4 }, (err, address, family) => {
  console.log("v4", err === null, typeof address, address, typeof family, family);
});
dns.lookup("host-that-cannot-exist.invalid", (err, address, family) => {
  console.log("fail", err === null ? "none" : err.message, address === undefined, typeof family, family === undefined);
  if (typeof address === "string") {
    console.log("never", address.length);
  } else {
    console.log("narrowed", address === null ? "null" : "undefined");
  }
});
console.log("queued");
