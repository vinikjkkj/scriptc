// A plain object thrown inside an async function reaches both a `.catch` handler and an `await` in a try block with its members.
async function af(code: string): Promise<void> { throw { code, message: "async " + code, nested: { k: [code] } }; }
async function viaAwait(): Promise<void> {
  try { await af("A2"); } catch (e: any) { console.log("await", e.code, e.message, JSON.stringify(e.nested)); }
}
af("A1").catch((e) => console.log("catch", e.code, e.message, JSON.stringify(e.nested)));
viaAwait().then(() => console.log("done"));
async function inner(): Promise<void> { throw [1, "two", { three: 3 }]; }
inner().catch((e) => console.log("array", e.length, e[1], e[2].three));
