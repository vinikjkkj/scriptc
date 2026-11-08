// import() of a mapped CommonJS package whose module.exports IS a class with named statics (ioredis' shape: `exports = module.exports = require("./Redis").default`,
// then getters for default and Redis and a plain helper). The namespace is the lexer's names plus default, and the class must construct, call and compare
// exactly as the static import of the same package does.
async function main(): Promise<void> {
  const ns = await import("expclass");
  const { Redis } = ns;
  const Def = ns.default;
  const r = new Redis({ host: "h" });
  console.log(r.get("k"), r.ping(), r.calls, r.opts.host);
  console.log(r instanceof Def, r instanceof Redis, Def === Redis, typeof ns.helper, ns.helper(1));
  console.log(new Def({ host: "x" }).get("y"), Object.keys(ns).sort().join(","));
}
main();
