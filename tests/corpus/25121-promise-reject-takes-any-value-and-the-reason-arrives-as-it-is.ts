// Promise.reject(reason) takes ANY value in JS, and the reason reaches every observer as the very value that was passed. The literal forms
// used to be refused (SC1090, "pass an Error instance"); the forms through an `unknown` parameter compiled, but on the C backend a
// string reason printed "[object Object]" from String(e).
function rej(v: unknown): Promise<void> {
  return Promise.reject(v);
}
function rejNumber(v: unknown): Promise<number> {
  return Promise.reject(v);
}

const s1: Promise<void> = Promise.reject("boom");
s1.catch((e) => console.log("s1", String(e), `${e}`, typeof e, e === "boom"));
const n1: Promise<number> = Promise.reject(42);
n1.catch((e) => console.log("n1", String(e), typeof e, e === 42));
const b1: Promise<string> = Promise.reject(false);
b1.catch((e) => console.log("b1", String(e), typeof e, e === false));
const z1: Promise<void> = Promise.reject(null);
z1.catch((e) => console.log("z1", String(e), typeof e, e === null));
const u1: Promise<void> = Promise.reject(undefined);
u1.catch((e) => console.log("u1", String(e), typeof e, e === undefined));
const o1: Promise<void> = Promise.reject({ code: 7 });
o1.catch((e) => console.log("o1", String(e), typeof e, e.code));
const e1: Promise<void> = Promise.reject(new RangeError("range"));
e1.catch((e) => console.log("e1", String(e), e instanceof RangeError, e.message));

function fromFn(): Promise<number> {
  return Promise.reject("fn");
}

async function main(): Promise<void> {
  try { await fromFn(); } catch (e) { console.log("await", String(e), `${e}`, typeof e); }
  try { await Promise.reject("direct"); } catch (e) { console.log("direct", String(e), typeof e); }
  try { await Promise.reject(7.5); } catch (e) { console.log("direct number", String(e), typeof e); }
  const settled = await Promise.allSettled([Promise.reject("a") as Promise<void>, Promise.reject(2) as Promise<void>, Promise.resolve()]);
  for (let i = 0; i < settled.length; i++) {
    const x = settled[i]!;
    console.log("settled", i, x.status, x.status === "rejected" ? String(x.reason) : "ok", x.status === "rejected" ? typeof x.reason : "");
  }
  const reasons: unknown[] = ["boom", 42, true, null, undefined, { code: 7 }, 0, "", false];
  for (const v of reasons) {
    try { await rej(v); } catch (e) { console.log("loop", String(e), typeof e, e === v); }
    try { await rejNumber(v); } catch (e) { console.log("loop number", String(e), typeof e, e === v); }
  }
  try { await Promise.all([rej("all")]); } catch (e) { console.log("all", String(e)); }
  try { await Promise.race([rej("race")]); } catch (e) { console.log("race", String(e)); }
  await rej("then").then(() => console.log("no"), (e) => console.log("then", String(e)));
  await rej("fin").finally(() => console.log("finally")).catch((e) => console.log("fin", String(e)));
  await rej("chain").then(() => 1).catch((e) => String(e) + "!").then((s) => console.log("chained", s));
}

process.on("unhandledRejection", (reason) => console.log("unhandled", String(reason), typeof reason));
rej("late handler");
rej(null);
rej(5);
main().then(() => console.log("done"));
