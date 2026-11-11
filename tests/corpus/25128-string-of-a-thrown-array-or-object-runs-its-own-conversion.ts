// String(e), `${e}` and `e + ""` over a catch binding whose value is an array, or an object with its own toString / valueOf, must convert
// like Node ("1,2", the toString text, valueOf first for `+`). They printed "[object Object]" for every non-scalar thrown value.
class Labeled { toString(): string { return "labeled"; } }
class Numeric { valueOf(): number { return 7; } }
class Both { valueOf(): number { return 7; } toString(): string { return "both-str"; } }
class Plain { x = 1; }

function thrower(i: number): void {
  if (i === 0) throw [1, 2];
  if (i === 1) throw { toString() { return "obj-custom"; } };
  if (i === 2) throw new Labeled();
  if (i === 3) throw new Numeric();
  if (i === 4) throw ["a", ["b", "c"]];
  if (i === 5) throw { a: 1 };
  if (i === 6) throw { valueOf() { return 5; }, toString() { return "both"; } };
  if (i === 7) throw new Plain();
  if (i === 8) throw [];
  if (i === 9) throw [[], [1], null];
  if (i === 10) throw new Both();
  if (i === 11) throw [1.5, true, "s"];
}
for (let i = 0; i < 12; i++) {
  try {
    thrower(i);
  } catch (e) {
    console.log(i, String(e), `${e}`, e + "", "<" + e + ">", typeof e);
  }
}

function rej(v: unknown): Promise<void> {
  return Promise.reject(v);
}
async function main(): Promise<void> {
  try { await rej([1, 2]); } catch (e) { console.log("rej array", String(e), `${e}`, e + ""); }
  try { await rej([3, [4, 5]]); } catch (e) { console.log("rej nested", String(e), `${e}`); }
  try { await rej({ toString() { return "rej-custom"; } }); } catch (e) { console.log("rej object", String(e), `${e}`); }
  try { await rej(new Labeled()); } catch (e) { console.log("rej labeled", String(e), `${e}`); }
  try { await rej(new Both()); } catch (e) { console.log("rej both", String(e), `${e}`, e + ""); }
  try { await rej({ a: 1 }); } catch (e) { console.log("rej plain", String(e)); }
  const p: Promise<void> = Promise.reject([7, 8]);
  await p.catch((e) => console.log("catch cb", String(e), `${e}`, e + ""));
  const q: Promise<void> = Promise.reject(new Labeled());
  await q.catch((e) => console.log("catch cb labeled", String(e)));
  const settled = await Promise.allSettled([rej([9]), rej(new Labeled())]);
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]!;
    if (r.status === "rejected") console.log("settled", i, String(r.reason), `${r.reason}`);
  }
}
main().then(() => console.log("done"));
