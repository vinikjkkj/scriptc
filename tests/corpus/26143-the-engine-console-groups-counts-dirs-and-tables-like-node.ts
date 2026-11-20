// The rest of the Console surface inside new Function text: group indentation, dir, count, table (arrays, maps, sets, column filters, scalars) and dirxml print as Node prints them.
const run: any = new Function(`
  console.log("a", 1, { x: [1, 2] });
  console.group("G1", 2);
  console.log("in g1\\nsecond line");
  console.group();
  console.log({ a: 1, b: { c: 2, d: [1, 2, 3] }, long: "x".repeat(70), more: "y".repeat(30) });
  console.groupEnd();
  console.groupEnd();
  console.dir({ a: { b: { c: { d: 1 } } } }, { depth: 0 });
  console.count(); console.count(); console.count("lab"); console.countReset(); console.count();
  console.table([{ a: 1, b: "x" }, { a: 2, c: true }]);
  console.table(new Map([["k1", { v: 1 }], ["k2", 2]]));
  console.table(new Set([1, "a"]));
  console.table([{ a: 1, b: 2 }, { a: 3, b: 4 }], ["b"]);
  console.table("scalar");
  console.dirxml({ a: 1 });
  return 1;
`);
run();
