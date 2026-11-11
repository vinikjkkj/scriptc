// `value + ""` where value is `unknown` (a catch binding, a parameter): tsc accepts it, Node concatenates ToPrimitive(value) with the
// string, and the compiler refused it (SC1100, "operators on 'unknown' values"). The string may be on either side.
async function fail(v: number): Promise<void> {
  if (v === 0) throw "text";
  if (v === 1) throw 42;
  if (v === 2) throw true;
  if (v === 3) throw null;
  if (v === 4) throw undefined;
  if (v === 5) throw { code: 7 };
  throw new TypeError("kind");
}

function joined(u: unknown): string {
  return u + "";
}
function framed(u: unknown): string {
  return "<" + u + ">";
}
function both(u: unknown): string {
  return u + "|" + u;
}

async function main(): Promise<void> {
  for (let i = 0; i < 7; i++) {
    try {
      await fail(i);
    } catch (e) {
      const a = e + "";
      const b = "" + e;
      console.log(i, a, b, "<" + e + ">", e + "!" + e, a.length, a === String(e), joined(e), framed(e), both(e));
    }
  }
  await fail(0).catch((e) => console.log("catch cb", e + "", "[" + e + "]"));
  const parsed: unknown[] = JSON.parse('[1, 2.5, "s", true, null, [1, [2, 3]], {"k": 1}, [], {}]');
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    console.log("parsed", i, joined(p), framed(p), both(p), typeof (p + ""));
  }
  let acc = "";
  for (let i = 0; i < parsed.length; i++) acc += parsed[i] + ";";
  console.log(acc);
}
main().then(() => console.log("done"));
