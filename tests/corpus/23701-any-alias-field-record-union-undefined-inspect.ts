// Union-typed and required `any`-alias fields holding undefined, null, primitives, arrays, dates and maps, an optional callback, a record spread and inspected.
type Handle = any;
interface Conf { readonly h: Handle; readonly list: Handle | Handle[]; readonly name: string; readonly cb?: (x: Handle) => string }
function show(c: Conf): string {
  const parts: string[] = [c.name, typeof c.h, Array.isArray(c.list) ? "arr" + c.list.length : typeof c.list];
  if (c.cb) parts.push(c.cb(c.h));
  return parts.join("|");
}
console.log(show({ h: undefined, name: "a", list: [1, 2, 3] }));
console.log(show({ name: "b", list: "s", h: 5, cb: (x) => "cb" + String(x) }));
console.log(show({ name: "c", list: 1, h: null, cb: (x) => String(x) }));
console.log(show({ name: "d", list: {}, h: { k: [1, { z: true }] }, cb: (x) => JSON.stringify(x) }));
const confs: Conf[] = [{ h: undefined, list: [], name: "x" }, { h: new Date(0), list: [1], name: "y" }, { h: new Map([[1, 2]]), list: 3, name: "z" }];
console.log(confs);
console.log(confs.map((c) => "h" in c));
let cnt = 0;
for (const c of confs) if (c.h !== undefined) cnt++;
console.log(cnt, confs[1]!.h instanceof Date, confs[2]!.h instanceof Map);
const copy: Conf = { ...confs[1]!, name: "copy" };
console.log(copy.name, copy.h === confs[1]!.h);
