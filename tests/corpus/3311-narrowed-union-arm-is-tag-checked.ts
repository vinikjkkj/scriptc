// The checker's union narrowing extracts through a TAG-CHECKED arm.
//
// tsc's control-flow analysis narrows a union-typed reference at its use
// sites; the IR value is still the tagged union, so every such use is
// bridged by an extraction of one arm's payload. That extraction used to
// be a bare peek: the tag was never looked at, and soundness rested
// entirely on tsc having been right. Where tsc is right the two are
// indistinguishable — which is what this program pins. Every narrowing
// below is HONEST, so the tag test always passes and every answer is
// Node's answer.
//
// Array.isArray and instanceof narrowings over a union are fenced on
// their own account, before any bridge runs, on base and here alike
// (SC1090), so no compiling program reaches those two bridges and they
// are not pinned below.
//
// The dishonest direction cannot be differential: Node reads the wrong
// field and prints undefined, scriptc throws the catchable TypeError.
// tests/harness/dyncheck.test.ts covers it, with the two shapes that used
// to answer wrongly instead of loudly — one segfaulted, one served a
// sibling arm's slot as if it were the field asked for.

interface Img {
  readonly kind: "img";
  readonly media: string;
  readonly width: number;
}
interface Txt {
  readonly kind: "txt";
  readonly text: string;
}
interface Doc {
  readonly kind: "doc";
  readonly text: string;
  readonly pages: number;
}
type Content = Img | Txt | Doc;

// 1. A discriminant test — the narrowing the runtime really did prove.
function byDiscriminant(c: Content): string {
  if (c.kind === "img") return "img:" + c.media + ":" + String(c.width);
  if (c.kind === "doc") return "doc:" + c.text + ":" + String(c.pages);
  return "txt:" + c.text;
}

// 2. An HONEST user type predicate — the checker's word, and it is true.
function isImg(c: Content): c is Img {
  return c.kind === "img";
}
function byPredicate(c: Content): string {
  return isImg(c) ? "P:" + c.media : "P:none";
}

// 3. `in` narrowing down to a single arm.
function byIn(c: Content): string {
  if ("pages" in c) return "in:" + String(c.pages);
  return "in:no";
}

// 4. typeof narrowing on a scalar union, both directions.
function byTypeof(v: string | number | boolean): string {
  if (typeof v === "number") return "n" + String(v + 1);
  if (typeof v === "string") return "s" + v.toUpperCase();
  return "b" + String(!v);
}

// 5. A NULL arm narrowed away by a guard, then read.
function byNullGuard(s: string | null): number {
  if (s === null) return -1;
  return s.length;
}

// 8. The narrowed reference read MANY times, and inside a loop — the
//    bridge is per-use, so a hot narrowing runs the tag test every time
//    and each extraction must own its own payload.
function readTwice(c: Content): string {
  if (c.kind === "doc") {
    let acc = "";
    for (let i = 0; i < 3; i++) acc += c.text + String(c.pages) + ";";
    return acc + c.text;
  }
  return "-";
}

// 9. The narrowed value flowing OUT: into a parameter, an array element,
//    a record field, and back into the union it came from.
function takeImg(i: Img): string {
  return i.media;
}
function flowOut(c: Content): string {
  if (!isImg(c)) return "flow:none";
  const arr: Img[] = [c];
  const rec = { held: c };
  const back: Content = c;
  return "flow:" + takeImg(c) + ":" + arr[0]!.media + ":" + rec.held.media + ":" + back.kind;
}

// 10. Narrowing under a NEGATED guard and in an else branch.
function byElse(c: Content): string {
  if (c.kind !== "img") {
    return "else:" + c.text;
  }
  return "else:img" + String(c.width);
}

// 11. Numbers behind a narrowing: the integer refinement that used to key
//     off the extraction node has to keep seeing through it.
function numbersBehindNarrow(v: number | string): string {
  if (typeof v === "string") return "s";
  let acc = 0;
  for (let i = 0; i < 4; i++) acc = (acc + (v | 0)) | 0;
  const shifted = (v | 0) << 3;
  const masked = (v | 0) & 0xff;
  return String(acc) + "," + String(shifted) + "," + String(masked) + "," + String(Math.floor(v / 2));
}

const items: Content[] = [
  { kind: "img", media: "a.png", width: 7 },
  { kind: "txt", text: "hello" },
  { kind: "doc", text: "spec", pages: 12 },
];

for (const it of items) {
  console.log(byDiscriminant(it));
  console.log(byPredicate(it));
  console.log(byIn(it));
  console.log(readTwice(it));
  console.log(flowOut(it));
  console.log(byElse(it));
}

console.log(byTypeof(41));
console.log(byTypeof("ok"));
console.log(byTypeof(false));

console.log(byNullGuard(null));
console.log(byNullGuard("abcd"));

console.log(numbersBehindNarrow(11));
console.log(numbersBehindNarrow("no"));

// 12. The same narrowing repeated a few thousand times: the extraction is
//     +1 on ref payloads and the tag check must not change that, so a
//     leak here shows up as an RC-audit failure rather than a wrong line.
let total = 0;
for (let i = 0; i < 2000; i++) {
  const c: Content = i % 2 === 0 ? { kind: "img", media: "m", width: i } : { kind: "txt", text: "t" };
  total += isImg(c) ? c.media.length : c.text.length;
}
console.log("loop", total);
