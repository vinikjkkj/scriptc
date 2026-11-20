// `Promise.reject(reason)` with a reason that is no Error: a plain object (members, nested), a string, a number and an array reach a
// `.catch`, a `then` rejection handler and an `await` in a try block as they were, and the executor's reject takes the same values.
const p1: Promise<void> = Promise.reject({ code: "R1", message: "rej", nested: { k: [1, 2] } });
p1.catch((e) => console.log("rej", e.code, e.message, JSON.stringify(e.nested)));
async function w(): Promise<void> {
  try { await (Promise.reject({ code: "R2" }) as Promise<void>); } catch (e: any) { console.log("await-rej", e.code); }
  try { await (Promise.reject("str") as Promise<void>); } catch (e: any) { console.log("await-str", e, typeof e); }
  try { await (Promise.reject(42) as Promise<void>); } catch (e: any) { console.log("await-num", e); }
  try { await (Promise.reject([1, "a"]) as Promise<void>); } catch (e: any) { console.log("await-arr", e.length, e[1]); }
}
w();
new Promise<void>((_, rj) => rj({ code: "R3" })).catch((e) => console.log("ctor-rej", e.code));
const p4: Promise<number> = Promise.reject({ code: "R4" });
p4.then(() => console.log("no"), (e) => console.log("then-rej", e.code));
