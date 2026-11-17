// Each instantiation reached through the `<string, unknown>` view (both ternary arms, chosen at run time), and the same instance reached
// through its own type and through the view: a mutation is visible both ways and identity holds.
class Counter<K, V> {
  readonly hits = new Map<K, number>();
  readonly store: Map<K, V>;
  constructor(store: Map<K, V>) { this.store = store; }
  bump(key: K): number {
    const n = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, n);
    return n;
  }
  forget(key: K): boolean { return this.hits.delete(key); }
  total(): number { let t = 0; for (const v of this.hits.values()) t += v; return t; }
}
const nums = new Counter<string, number>(new Map<string, number>());
const names = new Counter<string, string>(new Map<string, string>());
function pick(first: boolean): Counter<string, unknown> { return first ? nums : names; }
function same(a: Counter<string, unknown>, b: Counter<string, unknown>): boolean { return a === b; }
console.log(pick(true).bump("x"), pick(true).bump("x"), pick(false).bump("x"), pick(true).bump("y"));
console.log(nums.total(), names.total(), nums.hits.get("x"), names.hits.get("x"));
const viaView: Counter<string, unknown> = nums;
viaView.bump("x");
nums.bump("z");
console.log(nums.hits.get("x"), viaView.total(), viaView.forget("z"), nums.hits.has("z"), nums.total());
console.log(same(nums, viaView), same(nums, names), same(pick(false), names), viaView === nums, pick(true) === pick(false));
const views: Counter<string, unknown>[] = [nums, names, nums];
let sum = 0;
for (const v of views) sum += v.bump("q");
console.log(sum, nums.hits.get("q"), names.hits.get("q"));
