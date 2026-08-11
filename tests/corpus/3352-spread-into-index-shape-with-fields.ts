// A literal typed with an index signature AND a declared field —
// `{ jid, ...groupAttrs }` typed `{ [k: string]: string; jid: string }`,
// which is what tsc infers whenever a literal spreads a Record into a
// named key. The declared name lands in its slot, everything else in the
// overflow, and a runtime key that happens to name the declared field
// writes THROUGH to the slot (JS last-write-wins).

type Attrs = { [k: string]: string; jid: string };

let evals = 0;
function attrs(a: Record<string, string>): Record<string, string> {
  evals++;
  return a;
}

// Declared name first, runtime keys after.
function build(extra: Record<string, string>, jid: string): Attrs {
  return { jid, ...attrs(extra) };
}
const a = build({ role: "admin", n: "1" }, "x@s.whatsapp.net");
console.log(`${a.jid} ${a.role} ${a["n"]}`);
console.log(Object.keys(a).join(","));

// The spread's runtime key overwrites the declared slot.
const b = build({ jid: "override@s" }, "x@s.whatsapp.net");
console.log(b.jid, Object.keys(b).join(","));

// Spread first, declared name last: the named field wins.
function stamp(src: Record<string, string>, id: string): { [k: string]: string; id: string } {
  return { ...attrs(src), id };
}
const c = stamp({ tag: "iq", id: "old" }, "new");
console.log(`${c.id} ${c.tag}`);

// Two sources merge in order; a later key wins.
function two(x: Record<string, string>, y: Record<string, string>): Attrs {
  return { jid: "j", ...attrs(x), ...attrs(y) };
}
const d = two({ a: "1", b: "2" }, { b: "22", c: "3" });
console.log(`${d.jid} ${d.a} ${d.b} ${d.c}`);

// A runtime-computed key beside the declared one.
function keyed(k: string, v: string): Attrs {
  return { jid: "kj", [k]: v };
}
const e = keyed("dyn", "val");
console.log(`${e.jid} ${e["dyn"]}`);
const f = keyed("jid", "clobber");
console.log(f.jid);

// for-in and Object.entries see the merged keys.
const g = build({ p: "1", q: "2" }, "gj");
const seen: string[] = [];
for (const k in g) seen.push(k + "=" + g[k]);
console.log(seen.join(" "));
console.log(Object.entries(g).length);

// An absent overflow key reads undefined; the declared one never is.
console.log(g["missing"] === undefined, g.jid === "gj");

// Empty source: only the declared key survives.
const h = build({}, "only");
console.log(Object.keys(h).join(","), h.jid);

// A conditional spread beside the declared name: the key is written only
// on the taken arm, so an absent key stays absent.
function condy(flag: boolean, jid: string): Attrs {
  return { jid, ...(flag ? { extra: "yes" } : {}) };
}
console.log(Object.keys(condy(true, "j1")).join(","), condy(true, "j1")["extra"]);
console.log(Object.keys(condy(false, "j1")).join(","), condy(false, "j1")["extra"] === undefined);

// A whole source that may be absent contributes nothing for its unit arm.
function opt(jid: string, src?: Record<string, string>): Attrs {
  return { jid, ...src };
}
console.log(Object.keys(opt("j2", { a: "1" })).join(","), Object.keys(opt("j2")).join(","));

console.log("evals:", evals);
console.log("done");
