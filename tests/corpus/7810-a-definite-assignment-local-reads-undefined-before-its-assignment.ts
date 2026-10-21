// `let x!: T` locals read before their first assignment: Node reads undefined.
// Printing, templates, typeof, comparisons, ??, || and conditions see the
// undefined; a member use throws Node's exact TypeError. A closure created
// above the declaration (forward capture) is covered too.
function g() { let s!: string; console.log(s); console.log(typeof s, s === undefined, `v=${s}`); s = "k"; console.log(s); }
g();
function h() { let s!: string; try { console.log(s.length); } catch (e) { console.log((e as Error).message, e instanceof TypeError); } }
h();
function i() { let n!: number; console.log(n, typeof n, n === undefined, `${n}`); n = 3; console.log(n + 1); }
i();

function mk() {
  const coord = { publish: (n: number) => dispatch.publish(n) };
  let dispatch!: { publish: (n: number) => void };
  try { coord.publish(1); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : e instanceof ReferenceError ? "ReferenceError" : "other", (e as Error).message); }
  dispatch = { publish: (n) => console.log("pub", n) };
  coord.publish(3);
}
mk();
function ops() {
  let n!: number; let s!: string; let b!: boolean;
  console.log(n === undefined, s === undefined, b === undefined, n == null, s != null);
  console.log(n ?? 5, s ?? "dd", b ?? true);
  console.log(s || "or", n || 8, b || "bb");

  if (s === undefined) console.log("s undef");
  console.log(typeof n === "undefined", typeof s === "number");
  n = 1; s = "x"; b = false;
  console.log(n ?? 5, s ?? "dd", b ?? true, s || "or");
  n++; n += 2; console.log(n);
}
ops();
function cmp() {
  let n!: number; let s!: string;
  n += 2; s += "x"; console.log(n, s);
  let m!: number; m++; console.log(m);
  let k!: number; k = 1; k++; k *= 4; console.log(k);
}
cmp();

function mkCache() {
  const get = () => cache.size;
  let cache!: Map<string, number>;
  cache = new Map([["a", 1]]);
  console.log(get());
}
mkCache();
