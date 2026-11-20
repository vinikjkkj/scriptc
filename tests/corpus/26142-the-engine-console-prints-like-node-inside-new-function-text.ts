// console inside new Function text writes through Node's own formatting to the same stdout the static console uses.
const run: any = new Function(`
  console.log("plain", 1, true, null, undefined);
  console.log({ a: 1, b: [1, 2, 3], c: { d: { e: { f: 1 } } } });
  const o = {}; for (let i = 0; i < 9; i++) o["key" + i] = "value" + i;
  console.log(o);
  console.log("%s is %d years and %j", "Bob", 42, { x: 1 });
  console.log(new Map([["k", { v: 1 }]]), new Set([1, 2]), [1, , 3]);
  console.info("info"); console.debug("debug");
  return 7;
`);
console.log("before");
console.log(run());
console.log("after");
