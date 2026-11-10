// import() of a CommonJS file: the namespace's `default` and `module.exports` are module.exports, and the named exports are the ones Node's
// cjs-module-lexer detects (exports.a =, module.exports = { shorthand }, module.exports.c =), no more.
export {};
const t = async (f: string): Promise<void> => {
  const ns: any = await import(`./${f}`);
  console.log(f, Object.keys(ns).join(), typeof ns.default, Object.prototype.toString.call(ns));
};
const c1: any = await import("./c1.cjs");
console.log(c1.a, c1.b(), c1.default.a, c1.default === c1["module.exports"]);
const c2: any = await import("./c2.cjs");
console.log(Object.keys(c2).join(), c2.default.x, c2.default.y, c2.default.z());
const nk: any = await import("./nk.cjs");
console.log(Object.keys(nk).join(), JSON.stringify(nk.default), nk.a, nk.b, nk.c);
const again: any = await import("./c1.cjs");
console.log("same namespace", again === c1);
const c3: any = await import("./c3.cjs");
console.log(Object.keys(c3).join(), typeof c3.default);
await t("c1.cjs");
