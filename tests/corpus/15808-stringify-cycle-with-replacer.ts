// A cycle reached through a replacer walk throws V8's circular-structure
// TypeError, with the same message text Node prints.
const cyc: any = { name: "root" };
cyc.self = cyc;
try {
  JSON.stringify(cyc, (k: string, v: unknown) => v, 2);
  console.log("no throw");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
