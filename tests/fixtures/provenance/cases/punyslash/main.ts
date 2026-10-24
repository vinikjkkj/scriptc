// A CommonJS package (tr46lite) requires `punycode/` with a trailing slash, which
// names the npm package punycode (installed beside it), not the builtin.
import { toAscii, fromAscii, version } from "tr46lite";

console.log(toAscii("mañana.com"));
console.log(fromAscii("maana-pta"));
console.log(version);
