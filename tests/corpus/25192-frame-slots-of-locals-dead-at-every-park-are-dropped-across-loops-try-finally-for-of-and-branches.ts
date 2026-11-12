// A refcounted local that is never read after any await has no frame slot; each park releases it. Every shape below
// owns such locals (objects, strings, arrays) across awaits inside loops, try/catch/finally, for-of, switch and early
// returns, and the RC audit in the san lanes proves nothing is released twice or left behind.
class Holder {
  name: string;
  tags: string[];
  constructor(n: string) {
    this.name = n + "-holder";
    this.tags = [n, n + "x", n + "y"];
  }
}

function tick(n: number): Promise<number> {
  return new Promise<number>((r) => r(n));
}

function fail(n: number): Promise<number> {
  return new Promise<number>((_, rej) => rej(new Error("boom" + n)));
}

async function straight(k: string): Promise<number> {
  const o = new Holder(k);
  const s = o.name;
  await tick(1);
  return s.length;
}

async function dropsAll(k: string): Promise<number> {
  const a = new Holder(k);
  const b = [k, k + "1"];
  const c = k + "-str";
  const n = a.tags.length + b.length + c.length;
  await tick(2);
  return n;
}

async function inLoop(k: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const h = new Holder(k + i);
    const t = h.tags.join(",");
    total += t.length;
    await tick(i);
  }
  return total;
}

async function inForOf(items: string[]): Promise<string> {
  let out = "";
  for (const it of items) {
    const h = new Holder(it);
    const len = h.name.length;
    await tick(len);
    out += it + ":" + len + ";";
  }
  return out;
}

async function inTry(k: string): Promise<string> {
  const o = new Holder(k);
  const n = o.tags.length;
  try {
    await fail(n);
    return "unreached";
  } catch (e) {
    const m = new Holder("c" + k);
    const msg = (e as Error).message + m.name;
    await tick(n);
    return msg;
  } finally {
    const f = new Holder("f" + k);
    await tick(1);
    console.log("finally", f.name);
  }
}

async function branches(k: string, which: number): Promise<number> {
  const a = new Holder(k);
  if (which === 0) {
    const b = [k, k];
    await tick(b.length);
    return a.tags.length;
  }
  if (which === 1) {
    const c = k + k;
    const n = c.length;
    await tick(n);
    return n;
  }
  switch (which) {
    case 2: {
      const d = new Holder("d" + k);
      const n = d.name.length;
      await tick(n);
      return n;
    }
    default:
      return a.name.length;
  }
}

async function nested(k: string): Promise<number> {
  const o = new Holder(k);
  const n = o.tags.length;
  const inner = await straight(k + "i");
  const p = new Holder("p" + k);
  const m = p.name.length;
  const second = await dropsAll(k + "j");
  return n + inner + m + second;
}

async function readAfter(k: string): Promise<string> {
  const o = new Holder(k);
  const kept = o.name;
  const dead = [k, k, k];
  const n = dead.length;
  await tick(n);
  return kept + n;
}

async function main(): Promise<void> {
  console.log(await straight("abc"));
  console.log(await dropsAll("xy"));
  console.log(await inLoop("q"));
  console.log(await inForOf(["a", "bb", "ccc"]));
  console.log(await inTry("t"));
  for (let w = 0; w < 4; w++) console.log(await branches("b", w));
  console.log(await nested("n"));
  console.log(await readAfter("r"));
  const rs = await Promise.all([straight("m1"), dropsAll("m2"), inLoop("m3"), nested("m4")]);
  console.log(rs.join(","));
}

main();
