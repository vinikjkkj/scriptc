// Hash/Hmac update(data, encoding): every encoding Node accepts, Node's
// case-insensitive fold, the unknown-name utf8 fallback, undefined/null,
// the view-ignores-encoding rule, a run-time encoding, odd-length 'hex'
// throwing ERR_INVALID_ARG_VALUE, and the materialized handle.
import { createHash, createHmac } from "crypto";

const s = "aé€😀";
const encs = ["utf-8", "utf8", "UTF8", "base64", "base64url", "latin1", "binary", "ascii", "utf16le", "ucs2", "UCS-2", "bogus", "", "Utf-16LE"];
for (const e of encs) {
  const enc = e as unknown as "utf8";
  console.log(JSON.stringify(e), createHash("md5").update(s, enc).digest("hex"));
}
console.log("hex even", createHash("sha256").update("616263", "hex").digest("hex"));
console.log("hex stops at invalid", createHash("sha1").update("6162zz", "hex").digest("hex"));
console.log("raw digest length", createHash("md5").update("YWJj", "base64").digest().length);
const runEnc = "hex";
console.log("run-time encoding", createHash("md5").update("616263", runEnc).digest("hex"));
console.log("undefined encoding", createHash("md5").update("abc", undefined as unknown as "utf8").digest("hex"));
console.log("null encoding", createHash("md5").update("abc", null as unknown as "utf8").digest("hex"));
try { createHash("md5").update("abc", "hex"); } catch { console.log("odd hex threw"); }
try { createHash("md5").update("\u00e9", "hex"); } catch { console.log("odd hex utf8 threw"); }
const h = createHash("sha256");
h.update("abc", "latin1");
h.update("616263", "hex");
console.log("materialized", h.digest("hex"));
const hm = createHmac("sha256", "key");
hm.update("616263", "hex");
console.log("hmac hex", hm.digest("hex"));
