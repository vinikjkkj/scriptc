// `delete o.k` on an engine-held object removed nothing (it answered true and left the property); in Node the property is gone.
const mk: any = new Function("return { a: 1, b: 2, c: 3 }");
const o: any = mk();
console.log(delete o.a, o.a, Object.keys(o).join(","));
console.log(delete o["b"], Object.hasOwn(o, "b"), JSON.stringify(o));
console.log(delete o.zz, Object.keys(o).join(","));
const r = o as Record<string, number>;
delete r.c;
console.log(o.c, Object.keys(r).join(","), Object.keys(o).length);
