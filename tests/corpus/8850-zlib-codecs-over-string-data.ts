import { deflateSync, gzipSync, inflateSync, gunzipSync } from "zlib";
const d = deflateSync("data");
console.log(d.toString("hex"));
console.log(gzipSync("héllo wörld ✓").length);
console.log(inflateSync(d).toString());
console.log(gunzipSync(gzipSync("abc")).toString("utf8"));
const s: string = "x".repeat(50);
console.log(deflateSync(s).length);
