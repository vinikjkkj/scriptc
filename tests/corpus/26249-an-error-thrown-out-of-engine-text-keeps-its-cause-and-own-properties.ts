// An Error thrown inside new Function text and caught statically keeps its own enumerable properties and its `cause`, like Node.
for (const src of [
  `const e = new Error("boom", { cause: "why" }); e.code = "E_X"; e.status = 404; e.meta = { a: [1, 2] }; throw e;`,
  `class HttpError extends Error { constructor(m) { super(m); this.name = "HttpError"; this.statusCode = 502; } } throw new HttpError("bad gateway");`,
  `throw new TypeError("t", { cause: new RangeError("inner") });`,
  `const e = new Error("plain"); e.vis = true; throw e;`,
]) {
  try {
    new Function(src)();
  } catch (e: any) {
    console.log(e.name, e.message, e.code, e.status, e.meta, e.statusCode, e.vis, e.cause === undefined ? "nocause" : String(e.cause).split("\n")[0], e instanceof Error);
    console.log(Object.keys(e));
  }
}
