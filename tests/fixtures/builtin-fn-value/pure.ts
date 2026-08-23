/* Builtins held as VALUES — every form, compared cell by cell against
 * Node. No network: the fetch half of the same feature lives in
 * fetch-value.tmpl.ts, which needs an origin process.
 *
 * The cases are the list of ways a builtin-as-a-value can be SILENTLY
 * wrong rather than the list of things that are easy to assert:
 *
 *   IDENTITY        a value that is a fresh allocation per read makes
 *                   `a === isNaN` false where Node says true. Every
 *                   route a value can take to a comparison is a cell:
 *                   two aliases, a record field, an array element, an
 *                   argument, a return, a capture.
 *   A STALE BINDING a `let` reassigned after the first call must call
 *                   the NEW function, and the old value must still be
 *                   callable through whatever else holds it.
 *   AN OUTLIVING    a builtin captured by a closure that outlives the
 *   CAPTURE         frame that made it must still be callable, and must
 *                   still be the same pointer.
 *   THE CALL ITSELF the value form must answer exactly what the DIRECT
 *                   call answers, at every edge each builtin has
 *                   (NaN/Infinity, an empty string, a partial parse,
 *                   the reserved/unreserved URI sets, a malformed
 *                   escape's URIError).
 *
 * Prints "KEY value" lines; the harness compares each key's line against
 * Node's own and then the whole stream.
 */

function log(key: string, value: string): void {
  console.log(`${key} ${value}`);
}

// ---------------------------------------------------------------- identity
const nan1 = isNaN;
const nan2 = isNaN;
log("id-self", String(isNaN === isNaN));
log("id-alias", String(nan1 === isNaN));
log("id-two-aliases", String(nan1 === nan2));
log("id-distinct", String((isNaN as unknown) === (isFinite as unknown)));
log("id-pf-self", String(parseFloat === parseFloat));
log("id-eu-self", String(encodeURI === encodeURI));
log("id-du-self", String(decodeURIComponent === decodeURIComponent));

const rec: { f: (n: number) => boolean } = { f: isNaN };
log("id-record-field", String(rec.f === isNaN));

const arr: Array<(n: number) => boolean> = [isNaN, isFinite];
log("id-array-elem", String(arr[0] === isNaN));
log("id-array-elem2", String(arr[1] === isFinite));

function takes(g: (n: number) => boolean): boolean {
  return g === isNaN;
}
log("id-argument", String(takes(isNaN)));
log("id-argument-neg", String(takes(isFinite)));

function gives(): (n: number) => boolean {
  return isNaN;
}
log("id-returned", String(gives() === isNaN));
log("id-returned-twice", String(gives() === gives()));

// (A Map VALUE cannot be a function in this compiler at all -- SC2009 on
// the Map shape, user functions included -- so there is no builtin cell
// to write here. Named rather than silently omitted.)

// ------------------------------------------------------- outliving capture
function makeCapture(): () => boolean {
  const inner = isNaN;
  return () => inner === isNaN;
}
const captured = makeCapture();
log("capture-identity", String(captured()));

function makeCaller(): (n: number) => boolean {
  const inner = isFinite;
  return (n: number) => inner(n);
}
const callThrough = makeCaller();
log("capture-call-1", String(callThrough(1)));
log("capture-call-inf", String(callThrough(1 / 0)));

// --------------------------------------------------------- a stale binding
function myOwn(n: number): boolean {
  return n > 100;
}
let slot: (n: number) => boolean = isNaN;
const beforeReassign = slot;
log("stale-before", String(slot(0 / 0)));
slot = myOwn;
log("stale-after", String(slot(0 / 0)));
log("stale-after-2", String(slot(200)));
log("stale-old-still-callable", String(beforeReassign(0 / 0)));
log("stale-old-identity", String(beforeReassign === isNaN));
log("stale-new-identity", String((slot as unknown) === (isNaN as unknown)));

// -------------------------------------------------------- the ?? default
const optAbsent: { p?: (n: number) => boolean } = {};
const optPresent: { p?: (n: number) => boolean } = { p: myOwn };
const defaulted = optAbsent.p ?? isNaN;
const overridden = optPresent.p ?? isNaN;
log("nullish-absent", String(defaulted(0 / 0)));
log("nullish-absent-identity", String(defaulted === isNaN));
log("nullish-present", String(overridden(200)));
log("nullish-present-identity", String(overridden === isNaN));

// --------------------------------------------------------- typeof / truth
log("typeof-isNaN", typeof isNaN);
log("typeof-alias", typeof nan1);
log("typeof-parseFloat", typeof parseFloat);
const asUnknown: unknown = nan1;
log("truthy", asUnknown ? "yes" : "no");

// -------------------------------------------- the value answers the call
const vIsNaN = isNaN;
const vIsFinite = isFinite;
const vParseFloat = parseFloat;
const vEncodeURI = encodeURI;
const vDecodeURIComponent = decodeURIComponent;

const numbers: number[] = [0, -0, 1, -1, 0.5, 1e21, 1 / 0, -1 / 0, 0 / 0, 9007199254740993];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i]!;
  log(`isNaN-${i}`, `${String(vIsNaN(n))} ${String(isNaN(n))}`);
  log(`isFinite-${i}`, `${String(vIsFinite(n))} ${String(isFinite(n))}`);
}

const texts: string[] = [
  "3.5",
  "3.5x",
  "  12.25  ",
  "",
  "abc",
  "-0",
  "1e3",
  "Infinity",
  "-Infinity",
  ".5",
  "0x10",
];
for (let i = 0; i < texts.length; i++) {
  const s = texts[i]!;
  log(`parseFloat-${i}`, `${String(vParseFloat(s))} ${String(parseFloat(s))}`);
}

const uris: string[] = [
  "a b/c?d=e&f",
  "http://x/y z",
  "A-_.!~*'()",
  ";,/?:@&=+$#",
  "ü",
  "",
];
for (let i = 0; i < uris.length; i++) {
  const s = uris[i]!;
  log(`encodeURI-${i}`, `${vEncodeURI(s)} ${encodeURI(s)}`);
}

const encoded: string[] = ["a%20b%2Fc", "%C3%BC", "plain", "%41%42", ""];
for (let i = 0; i < encoded.length; i++) {
  const s = encoded[i]!;
  log(`decodeURIComponent-${i}`, `${vDecodeURIComponent(s)} ${decodeURIComponent(s)}`);
}

// A malformed escape is a URIError in Node, and it must be one through
// the value too — a value form that swallowed it would be the quietest
// possible divergence.
try {
  const bad = vDecodeURIComponent("%E0%A4%A");
  log("decode-malformed", `NO THROW ${bad}`);
} catch (e) {
  log("decode-malformed", (e as Error).name);
}
try {
  decodeURIComponent("%E0%A4%A");
  log("decode-malformed-direct", "NO THROW");
} catch (e) {
  log("decode-malformed-direct", (e as Error).name);
}

log("END", "done");
