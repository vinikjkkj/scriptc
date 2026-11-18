// A typed array or Buffer reached through an `any` binding dispatches its method by NAME at run time. Every known name must pick its own method (including names that share a
// first letter and a prefix with others: at/atx, set/sets, slice/slic/sliceX, map/mapX, join/joint) and an unknown name must throw Node's TypeError, not match a near name.
function call(label: string, f: () => unknown): void {
  try {
    const r = f();
    console.log(label, r instanceof Uint8Array ? Array.from(r).join(",") : r);
  } catch (e) {
    console.log(label, "threw", (e as Error).constructor.name, (e as Error).message);
  }
}
const mk = (): any => Buffer.from([5, 1, 4, 2, 3]);
const d: any = mk();
call("at", () => d.at(1));
call("at-neg", () => d.at(-1));
call("indexOf", () => d.indexOf(4));
call("lastIndexOf", () => d.lastIndexOf(3));
call("includes", () => d.includes(2));
call("join", () => d.join("-"));
call("slice", () => d.slice(1, 3));
call("subarray", () => d.subarray(2));
call("map", () => d.map((x: number) => x * 2));
call("filter", () => d.filter((x: number) => x > 2));
call("find", () => d.find((x: number) => x > 3));
call("findIndex", () => d.findIndex((x: number) => x > 3));
call("some", () => d.some((x: number) => x > 4));
call("every", () => d.every((x: number) => x > 0));
call("reduce", () => d.reduce((a: number, x: number) => a + x, 0));
call("reduceRight", () => d.reduceRight((a: number, x: number) => a * 10 + x, 0));
call("toString", () => d.toString("hex"));
call("toJSON", () => JSON.stringify(d.toJSON()));
call("equals", () => d.equals(Buffer.from([5, 1, 4, 2, 3])));
call("fill", () => mk().fill(9));
call("reverse", () => mk().reverse());
call("toReversed", () => d.toReversed());
call("toSorted", () => d.toSorted());
call("sort", () => mk().sort());
call("with", () => d.with(0, 7));
call("copyWithin", () => mk().copyWithin(0, 3));
call("set", () => { const t = new Uint8Array(4); t.set([1, 2], 1); return t; });
call("unknown-a", () => d.atx(1));
call("unknown-b", () => d.sets([1]));
call("unknown-c", () => d.slic(1));
call("unknown-d", () => d.sliceX(1));
call("unknown-e", () => d.mapX(1));
call("unknown-f", () => d.joint("-"));
call("unknown-g", () => d.foo());
call("unknown-h", () => d.reducer(1));
call("unknown-i", () => d.f());
const u: any = new Uint8Array([3, 1, 2]);
call("u-at", () => u.at(0));
call("u-map", () => u.map((x: number) => x + 1));
call("u-unknown", () => u.mapp(1));
call("u-length", () => u.length);
