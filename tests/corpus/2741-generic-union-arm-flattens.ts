// A type parameter BOUND to a union, used inside a union in the body:
// `Map<string, T>.get(k)` is `T | undefined`, and after substitution that
// arm is itself a union. ts never spells a nested union — it flattens every
// one it can SEE — so the nesting exists only after the binding is applied,
// and the IR has no slot for it. It is not an ambiguity either:
// `(A | B) | undefined` IS `A | B | undefined`, which is the arm set the
// runtime tag has to tell apart anyway. Splicing the arms in is what the
// caller's own union already carries.

type UserResult =
  | { readonly userJid: string; readonly devices: readonly number[] }
  | { readonly userJid: string; readonly errorText: string };

function mergePreferred<T>(
  target: Map<string, T>,
  key: string,
  next: T,
  isPreferred: (value: T) => boolean,
): void {
  const current = target.get(key);
  if (!current || !isPreferred(current)) {
    target.set(key, next);
  }
}

// The generic-in-generic shape: T is passed THROUGH, so the inner instance
// binds a parameter that is itself only bound by an outer binding.
function registerBoth<T>(
  byRaw: Map<string, T>,
  byCanonical: Map<string, T>,
  rawKey: string,
  canonicalKey: string,
  result: T,
  isPreferred: (value: T) => boolean,
): void {
  mergePreferred(byRaw, rawKey, result, isPreferred);
  mergePreferred(byCanonical, canonicalKey, result, isPreferred);
}

function preferred(r: UserResult): boolean {
  return "devices" in r;
}
function tagOne(r: UserResult): string {
  return "devices" in r ? "dev:" + String(r.devices.length) : "err:" + r.errorText;
}
function tag(r: UserResult | undefined): string {
  if (!r) return "none";
  return tagOne(r);
}

const byRaw = new Map<string, UserResult>();
const byCanonical = new Map<string, UserResult>();
registerBoth(byRaw, byCanonical, "a", "ca", { userJid: "a", errorText: "boom" }, preferred);
// The preferred arm displaces the stored one — the union arms have to be
// told apart at runtime for this to answer right.
registerBoth(byRaw, byCanonical, "a", "ca", { userJid: "a", devices: [1, 2] }, preferred);
// … and the already-preferred one is NOT displaced by a lesser arm.
registerBoth(byRaw, byCanonical, "a", "ca", { userJid: "a", errorText: "late" }, preferred);
registerBoth(byRaw, byCanonical, "b", "cb", { userJid: "b", errorText: "bad" }, preferred);
console.log(tag(byRaw.get("a")), tag(byRaw.get("b")), tag(byRaw.get("z")));
console.log(tag(byCanonical.get("ca")), tag(byCanonical.get("cb")));

// The same flattening through a NULL companion and through an array of the
// substituted union — the other two spellings the nesting takes.
function firstOr<T>(xs: readonly T[], fallback: T): T | null {
  return xs.length > 0 ? xs[0]! : (xs.length === 0 ? fallback : null);
}
const arms: UserResult[] = [{ userJid: "c", devices: [7] }, { userJid: "d", errorText: "e" }];
const picked = firstOr(arms, { userJid: "f", errorText: "fallback" });
console.log(picked === null ? "null" : tag(picked));
console.log(tag(firstOr([] as UserResult[], { userJid: "g", errorText: "empty" }) ?? undefined));

// A binding that is NOT a union keeps the ordinary path — no flattening,
// same answers.
const plain = new Map<string, { readonly n: number }>();
mergePreferred(plain, "k", { n: 1 }, (v) => v.n > 5);
mergePreferred(plain, "k", { n: 9 }, (v) => v.n > 5);
mergePreferred(plain, "k", { n: 2 }, (v) => v.n > 5);
const got = plain.get("k");
console.log(got === undefined ? -1 : got.n);
