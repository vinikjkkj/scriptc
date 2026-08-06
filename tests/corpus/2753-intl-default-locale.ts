// `Intl.DateTimeFormat().resolvedOptions().locale` — the MACHINE's default
// locale tag, read at runtime rather than baked. Node is the oracle and
// both sides run on the same host, so this program pins AGREEMENT with
// whatever this machine reports, not a particular string: a lowering that
// answered a constant would pass on the build host and fail everywhere
// else, and the value reaches the wire (zapo's ClientPayload carries it as
// localeLanguageIso6391 / localeCountryIso31661Alpha2).

// The plain form, and the `new` spelling the spec makes identical.
const plain = Intl.DateTimeFormat().resolvedOptions().locale;
const constructed = new Intl.DateTimeFormat().resolvedOptions().locale;
console.log(typeof plain, plain === constructed);

// It is a well-formed BCP-47 tag: non-empty, no whitespace, no '_', and a
// lowercase 2–8 alpha language subtag. Printing the SHAPE rather than the
// value keeps the assertions readable off this host too.
console.log(plain.length > 0, plain.indexOf("_") < 0, plain.indexOf(" ") < 0);
const language = plain.split("-")[0] ?? "";
console.log(language.length >= 2 && language.length <= 8, language === language.toLowerCase());

// zapo's exact idiom: the `|| 'en-US'` guard, then split with defaults.
const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
const parts = locale.split("-");
const lg = (parts[0] ?? "en").toLowerCase();
const lc = (parts[1] ?? "US").toUpperCase();
console.log(lg, lc, lg.length, lc.length);

// The region subtag, when present, is already uppercase (ICU's canonical
// spelling) — the split above must not be the thing that fixes it.
if (parts.length > 1) {
  const region = parts[1] ?? "";
  console.log("region:", region === region.toUpperCase(), region.length === 2 || region.length === 3);
} else {
  console.log("region: absent");
}

// The value is stable within a process, exactly as ICU's default is: it
// resolves once and later environment writes do not move it.
process.env["LANG"] = "pt_BR.UTF-8";
process.env["LC_ALL"] = "pt_BR.UTF-8";
console.log(Intl.DateTimeFormat().resolvedOptions().locale === plain);

// Refcount pressure on the interned string: many reads, each one owning
// its result, interleaved with values that outlive the loop. An
// unbalanced release would free the interned tag out from under the
// later reads; an unbalanced retain shows up in the RC audit.
const held: string[] = [];
let sameCount = 0;
let charSum = 0;
for (let i = 0; i < 2000; i++) {
  const tag = Intl.DateTimeFormat().resolvedOptions().locale;
  if (tag === plain) sameCount++;
  charSum += tag.length;
  if (i % 500 === 0) held.push(tag);
  // A fresh string derived from the interned one, dropped immediately.
  if (tag.toUpperCase().length !== tag.length) charSum -= 1;
}
console.log(sameCount, charSum === plain.length * 2000, held.length);
console.log(held.every((t) => t === plain));

// Still intact after the loop, and still the same value.
console.log(Intl.DateTimeFormat().resolvedOptions().locale === plain);

// Inside a template and a concatenation — the interned string flowing
// into fresh allocations.
console.log(`[${plain}]` === "[" + plain + "]");

// Memoized behind a frozen record, zapo's own shape.
let cached: { readonly lg: string; readonly lc: string } | null = null;
function resolveLocale(): { readonly lg: string; readonly lc: string } {
  if (cached !== null) return cached;
  const l = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  const p = l.split("-");
  cached = Object.freeze({ lg: (p[0] ?? "en").toLowerCase(), lc: (p[1] ?? "US").toUpperCase() });
  return cached;
}
const a = resolveLocale();
const b = resolveLocale();
console.log(a.lg === lg, a.lc === lc, a === b);
console.log(JSON.stringify(resolveLocale()));
