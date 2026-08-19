// SHA-256 across EVERY message length a compression loop can get wrong.
//
// The digest core now has two arms — the scalar FIPS 180-4 round loop and,
// on any x86-64 with the SHA extensions, a vector one chosen by CPUID at
// run time. Both must answer identically to Node, and the places an
// alternate compression loop actually breaks are all length-shaped:
//
//   0                 no message block at all, pure padding
//   55 / 56           the last length that fits one block / the first
//                     that forces a second (the 0x80 + 8-byte length)
//   63 / 64 / 65      the block seam itself, where a multi-block loop
//                     carries state from one block to the next
//   119 / 120         the same seam one block along
//   every 1..320      the schedule and the state carry, exhaustively
//
// A wrong round constant, a state-word pair swapped on save or restore, a
// message schedule off by one word: each shows up as a different digest at
// SOME length, so the chain below is a single value that no partially
// correct implementation can reproduce. The individual anchors around it
// exist so a failure names the length that broke rather than only the sum.
//
// sha1, sha512 and md5 ride along unchanged and are printed as the
// collateral control: they share the padding shape but not the core.
import { createHash } from "node:crypto";

function h(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ── the anchors: one digest per interesting length ──────────────────
const anchors = [0, 1, 2, 3, 54, 55, 56, 57, 62, 63, 64, 65, 66,
                 118, 119, 120, 121, 127, 128, 129, 191, 192, 255, 256];
for (let i = 0; i < anchors.length; i++) {
  const n = anchors[i];
  console.log(n + " " + h("a".repeat(n)));
}

// ── the chain: every length 0..320, folded so one line proves them all ──
// Each step hashes the PREVIOUS digest concatenated with a message of the
// next length, so the value depends on all 321 digests in order and on the
// 64-hex-char prefix making every input at least one full block long.
let chain = "";
for (let n = 0; n <= 320; n++) {
  chain = h(chain + "x".repeat(n));
}
console.log("chain0-320 " + chain);

// ── the same sweep over non-ASCII bytes: the schedule must not care ──
let uchain = "";
for (let n = 0; n <= 96; n++) {
  uchain = h(uchain + "é✓".repeat(n));
}
console.log("uchain0-96 " + uchain);

// ── a genuinely long message: 64 blocks in one call ──────────────────
console.log("4096 " + h("abcdefgh".repeat(512)));
console.log("4097 " + h("abcdefgh".repeat(512) + "z"));

// ── base64 encoding of the same digest, and the raw-Buffer surface ───
console.log(createHash("sha256").update("a".repeat(64)).digest("base64"));
console.log(Buffer.from(createHash("sha256").update("a".repeat(65)).digest()).toString("hex"));

// ── Buffer input, including NUL and high bytes across a block seam ───
const bytes: number[] = [];
for (let i = 0; i < 130; i++) bytes.push((i * 7 + 3) & 255);
console.log("bytes130 " + createHash("sha256").update(Buffer.from(bytes)).digest("hex"));

// ── collateral: the three digests this change does not touch ─────────
console.log("sha1   " + createHash("sha1").update("a".repeat(64)).digest("hex"));
console.log("sha512 " + createHash("sha512").update("a".repeat(129)).digest("hex"));
console.log("md5    " + createHash("md5").update("a".repeat(64)).digest("hex"));
