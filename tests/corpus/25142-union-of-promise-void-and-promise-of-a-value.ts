// `Promise<void> | Promise<T>` (and unions of functions returning them) had no representation: the void payload had no home in the combined payload
// union. A void payload settles to undefined, so the combined promise settles to `T | undefined`.
async function value(): Promise<number> { return 41; }
async function nothing(): Promise<void> { console.log("nothing ran"); }
async function text(): Promise<string> { return "text"; }

const pick = (n: number): Promise<number> | Promise<void> => (n > 0 ? value() : nothing());
const run: (() => Promise<number>) | (() => Promise<void>) = Math.random() > 2 ? value : nothing;
const three: (() => Promise<number>) | (() => Promise<string>) | (() => Promise<void>) = Math.random() > 2 ? value : nothing;

async function main(): Promise<void> {
  const a = await pick(1);
  const b = await pick(0);
  console.log(a, b, typeof a, typeof b);
  const r = await run();
  console.log(r, typeof r);
  const t = await three();
  console.log(t, typeof t);
  for (const [name, fn] of [["value", value], ["nothing", nothing], ["text", text]] as const) {
    const out = await fn();
    console.log(name, out, typeof out);
  }
  const combined: Promise<void> | Promise<string> = Math.random() > 2 ? nothing() : text();
  console.log(await combined);
}
main().then(() => console.log("done"));
