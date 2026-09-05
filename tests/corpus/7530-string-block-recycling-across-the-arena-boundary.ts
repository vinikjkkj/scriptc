// Heap-string BLOCKS, not string semantics: the runtime carves every string
// whose physical block is <= SCR_POOL_MAX out of an arena and mallocs every
// larger one, and the two provenances are told apart by ONE predicate over
// ScrStr::cap. A block that crosses the line and is freed to the wrong
// allocator is a heap corruption, and heap corruption on this target does
// not fault — it answers wrongly, later, somewhere else.
//
// The boundary is sizeof(ScrStr) + cap + 1 rounded up to SCR_POOL_GRAIN
// against SCR_POOL_MAX, i.e. cap 243 is the last carved capacity and 244 is
// the first malloc'd one. Nothing in this file knows those numbers: it walks
// EVERY length from 0 to 300 through every construction path, so the
// boundary is crossed by each of them whatever the constants become.
//
// The three shapes that can each place a string on the wrong side:
//   * concat, which adds SCR_STR_CHAIN_SLACK to a short result, so a
//     len-235 result already carries cap 243;
//   * the JSON builder, whose first buffer is 64 bytes (carved) and which
//     DOUBLES past the boundary — that is a realloc of a carved block, and
//     the one path in the runtime that had to be rewritten for it;
//   * churn, which frees blocks back and takes them out again, so a block
//     that was mis-classed once is handed to a later string of a different
//     length and the wrong bytes are what get printed.

function ruler(n: number): string {
  // Distinct content per length AND per position, so a block handed out at
  // the wrong width prints visibly wrong bytes rather than plausible ones.
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(33 + (i % 94));
  return s;
}

function digest(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

// ── 1. every length across the boundary, five construction paths ──────────
// Each path lands on a different (len, cap) pair for the same length, so the
// boundary falls at a different length in each column.
for (let n = 0; n <= 300; n++) {
  const base = ruler(n);
  const byConcat = ruler(n - 1 > 0 ? n - 1 : 0) + (n > 0 ? String.fromCharCode(33 + ((n - 1) % 94)) : "");
  const bySlice = (ruler(n) + "TAIL").slice(0, n);
  const byRepeat = n === 0 ? "" : ("x".repeat(n));
  const byTemplate = `${ruler(n)}`;
  const byPad = "".padEnd(n, "y");
  if (n % 37 === 0 || (n >= 236 && n <= 252)) {
    console.log(
      "len", n,
      base.length, digest(base),
      byConcat.length, digest(byConcat), byConcat === base,
      bySlice.length, digest(bySlice), bySlice === base,
      byRepeat.length, digest(byRepeat),
      byTemplate.length, digest(byTemplate), byTemplate === base,
      byPad.length, digest(byPad),
    );
  }
}

// ── 2. the JSON builder growing a carved block past the boundary ──────────
// The first buffer is small and carved; stringifying something that needs
// more than it forces the regrow, and doubling walks it out of the arena.
// The whole payload is checked back by parse, so a truncated or corrupted
// copy in the regrow is a wrong answer here and not a silent short buffer.
for (const n of [1, 7, 31, 60, 61, 62, 63, 64, 65, 100, 180, 230, 240, 243, 244, 250, 256, 300, 1000]) {
  const obj = { k: ruler(n), n: n, arr: [ruler(n), ruler(n > 0 ? n - 1 : 0)] };
  const text = JSON.stringify(obj);
  const back = JSON.parse(text) as { k: string; n: number; arr: string[] };
  console.log("json", n, text.length, digest(text), back.k === obj.k, back.arr[0] === obj.k,
              back.arr[1].length, back.n);
}

// ── 3. churn: free a whole population, then take the blocks back at OTHER
// widths. A block returned to the wrong class shows up as a wrong length or
// wrong bytes on the SECOND population, never on the first.
{
  const widths = [8, 16, 40, 100, 200, 235, 236, 243, 244, 245, 260, 400];
  let acc = 0;
  for (let round = 0; round < 6; round++) {
    const live: string[] = [];
    for (let i = 0; i < widths.length; i++) {
      const w = widths[(i + round) % widths.length];
      live.push(ruler(w) + "|" + round);
    }
    for (const s of live) acc = (acc + digest(s)) & 0x7fffffff;
    // drop every reference; the next round takes the same blocks back
    live.length = 0;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[(widths.length - 1 - i + round) % widths.length];
      const s = ruler(w).slice(0, w) + "#" + round;
      acc = (acc + digest(s) + s.length) & 0x7fffffff;
    }
  }
  console.log("churn", acc);
}

// ── 4. the surfaces where a string's identity is observable at all ────────
// Strings are primitives, so `===` is a VALUE comparison and no allocator
// can move it. The things that are NOT primitives are checked here against
// the same expectation Node states.
// It runs at SEVERAL lengths and not only at 243, because a second
// allocator behaviour has since landed on this same population: concat
// results in [16, 128] BYTES are content-interned, so two byte-equal strings
// there are ONE heap block, and 243 is outside that band. A section named
// "the surfaces where identity is observable" that only runs where nothing
// is shared observes nothing. 15 is below the band, 16 and 128 are its
// edges, 129 is above it, 243 is the arena's last carved capacity.
//
// Interning has its own file for the surfaces that are specific to it
// (7570); what belongs HERE is that these answers do not depend on which
// allocator behaviour a length happens to fall under.
for (const n of [15, 16, 64, 128, 129, 243]) {
  const a = ruler(n);
  const b = ruler(n);
  console.log("prim eq", n, a === b, a == b, Object.is(a, b), a < b, a.localeCompare(b));

  // `new String` has no scriptc lowering (SC2020) and cannot appear in a
  // corpus program at all; the wrapper surfaces that DO lower are here.
  console.log("wrapper", n, String(a) === a, a.toString() === a, `${a}` === a, typeof a);

  const symA: symbol = Symbol(a);
  const symB: symbol = Symbol(a);
  console.log("symbol", n, symA === symB, symA.description === a, symA.toString().length);
  const forA: symbol = Symbol.for(a);
  const forB: symbol = Symbol.for(b);
  console.log("symbol for", n, forA === forB, Symbol.keyFor(forA) === a);

  // Map/Set key identity is value identity for primitives, on both sides.
  const m = new Map<string, number>();
  m.set(a, 1);
  m.set(b, 2);
  console.log("map", n, m.size, m.get(a), m.get(ruler(n)));
  const st = new Set<string>([a, b, ruler(n), ruler(n + 1)]);
  console.log("set", n, st.size);

  // Buffer.toString and back: bytes out of a different allocator entirely.
  const buf = Buffer.from(a, "utf8");
  console.log("buffer", n, buf.length, buf.toString("utf8") === a,
              buf.toString("utf8", 0, n).length, Buffer.from(buf).toString("utf8") === a);
}

// ── 5. the same population through a dyn boundary ─────────────────────────
{
  const rows: Record<string, string> = {};
  // 15..129 straddle the content-intern band as well as the arena boundary,
  // so a record crossing carries both populations.
  for (const n of [15, 16, 17, 63, 64, 128, 129, 242, 243, 244, 245]) rows["k" + n] = ruler(n);
  const text = JSON.stringify(rows);
  const parsed = JSON.parse(text) as Record<string, string>;
  const keys = Object.keys(parsed).sort();
  for (const k of keys) {
    console.log("rec", k, parsed[k].length, parsed[k] === rows[k], digest(parsed[k]));
  }
  console.log("rec keys", keys.join(","), text.length);
}
