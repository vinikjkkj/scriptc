// The pg SCRAM/MD5 helper shape: a string through update(data, 'utf-8') on
// the chain, the digest bytes read back with Array.from(new Uint8Array(...))
// and hex-encoded, plus an HMAC-SHA256 round over those bytes.
import { createHash, createHmac } from "crypto";

function md5hex(text: string): string {
  return createHash("md5").update(text, "utf-8").digest("hex");
}

function hexOf(buf: Uint8Array): string {
  return Array.from(new Uint8Array(buf.buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const inner = md5hex("passéword" + "user");
console.log(inner);
const salt = Buffer.from([1, 2, 3, 4]);
const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest();
console.log("md5" + hexOf(outer));
const key = createHmac("sha256", "salted-pw").update("Client Key", "utf-8").digest();
const proof = createHash("sha256").update(key).update("AuthMessage", "utf-8").digest("hex");
console.log(proof, hexOf(key).length);
