// A context import (`./data/${name}`) covers .json and .cjs files too: each file present at build time is in the table.
export {};
const dir = import.meta.dirname;
async function load(name: string, json: boolean): Promise<void> {
  try {
    const m: any = json ? await import(`./data/${name}`, { with: { type: "json" } }) : await import(`./data/${name}`);
    console.log("loaded", name, JSON.stringify(m.default ?? m.id));
  } catch (e) {
    const err = e as Error & { code?: string };
    console.log("rejected", name, err.code, err.message.split(dir).join("<dir>"));
  }
}
await load("alpha.json", true);
await load("beta.json", true);
await load("alpha.json", false);
await load("m1.cjs", false);
const m2: any = await import(`./mods/${"m2.ts"}`);
console.log("loaded m2", m2.id);
await load("m1.cjs", true);
await load("nope.json", true);
