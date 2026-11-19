// Destructuring an `any` value in TypeScript: object patterns (defaults, renames, nested, rest), array patterns, strings/arrays/numbers as
// sources, and the V8 "Cannot destructure property ..." / "is not iterable" errors for null and undefined sources.
function plain(a: any) {
  const { x, y } = a;
  console.log(x, y);
}
plain({ x: 1, y: 2 });
function defaults(a: any) {
  const { x = 10, y: { z } = { z: 4 }, w: w2 } = a;
  const [p, q = "dq"] = a.list ?? [];
  console.log(x, z, w2, p, q);
}
defaults({ w: "W", list: [1] });
defaults({ x: 3, y: { z: 9 }, list: ["a", "b"] });
function kinds(a: any) {
  const { length } = a;
  const [c0, c1] = a;
  console.log(length, c0, c1);
}
kinds("héy");
kinds([7, 8, 9]);
function nullish(a: any) {
  try { const { x } = a; console.log(x); } catch (e) { console.log((e as Error).message); }
  try { const { x: { y } } = a; console.log(y); } catch (e) { console.log((e as Error).message); }
  try { const {} = a; console.log("empty ok"); } catch (e) { console.log((e as Error).message); }
  try { const [x] = a; console.log(x); } catch (e) { console.log((e as Error).message); }
  try { const { x } = (a as any).b; console.log(x); } catch (e) { console.log((e as Error).message); }
}
nullish(null);
nullish(undefined);
nullish(5);
nullish({ x: {}, b: {} });
function rest(b: any, c: any) {
  const { z = 5, p, ...others } = b;
  console.log(z, p, others, Object.keys(others).length);
  const { ...all } = c;
  console.log(all, all === c);
}
rest({ p: 1, q: 2, r: 3 }, { a: 1, b: { c: 2 }, 0: "z" });
rest(JSON.parse('{"q":"s"}'), "ab");
rest({ z: 9, "k-1": 1 }, [4, 5]);
function restNullish(b: any) { try { const { a, ...r } = b; console.log(a, r); } catch (e) { console.log((e as Error).message); } }
restNullish(null);
restNullish(undefined);
restNullish(5);
