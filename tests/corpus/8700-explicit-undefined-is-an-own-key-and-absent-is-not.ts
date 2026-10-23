// `{ a: undefined }` has the own key "a" and `{}` does not. An optional
// member and a member typed `T | undefined` share one record shape, so the
// slot's undefined arm cannot tell them apart: each literal says which
// members it wrote, and writes, `delete` and copies keep that true.
interface P {
  a?: number;
  b?: string;
  c?: number;
}
const u = process.argv.length > 99 ? 1 : undefined;
const show = (label: string, p: P): void => {
  console.log(label, p);
  console.log(label, JSON.stringify(p), Object.keys(p), Object.entries(p));
  console.log(label, "a" in p, "b" in p, Object.hasOwn(p, "a"), Object.hasOwn(p, "b"), Object.hasOwn(p, "c"));
  console.log(label, { ...p });
};
show("absent", { c: 3 });
show("explicit", { a: undefined, c: 3 });
show("computed", { a: u, c: 3 });
const w: P = { a: 1 };
w.b = "x";
w.c = 3;
w.a = undefined;
show("assigned-undefined", w);
delete w.a;
show("deleted", w);
w.b = "y";
show("rewritten", w);
const copy: P = { ...w };
show("spread-copy", copy);
const none: P = {};
show("empty", none);
