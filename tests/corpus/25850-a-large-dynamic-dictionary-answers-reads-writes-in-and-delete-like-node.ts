// A dyn object with many members (the member index) must answer exactly what a scan answers: reads, `in`, overwrite
// (position fixed), delete (order of the rest fixed), re-add (lands last), accessors and non-enumerables on a big table.
function mk(): any {
  return {};
}
let bad = 0;
let checks = 0;
function ck(ok: boolean, what: string): void {
  checks++;
  if (!ok) {
    bad++;
    console.log("BAD " + what);
  }
}
for (const n of [15, 31, 32, 33, 63, 64, 65, 300]) {
  const d = mk();
  const model: Record<string, number> = {};
  const order: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = "key_" + i + "_" + ((i * 7919) % 1000) + "@s.whatsapp.net";
    d[k] = i + 1;
    model[k] = i + 1;
    order.push(k);
  }
  for (let i = 0; i < n; i += 7) {
    const k = order[i]!;
    d[k] = -(i + 1);
    model[k] = -(i + 1);
  }
  for (let i = 0; i < n; i += 5) {
    const k = order[i]!;
    delete d[k];
    delete model[k];
    order[i] = "";
    const j = (i + 1) % n;
    const kj = order[j]!;
    ck(kj === "" ? d["nope"] === undefined : d[kj] === model[kj], "read after delete " + n + " " + i);
  }
  const live = order.filter((k) => k !== "");
  for (let i = 0; i < n; i += 15) {
    if (order[i] === "") {
      const k = "key_" + i + "_re";
      d[k] = 1000 + i;
      model[k] = 1000 + i;
      live.push(k);
    }
  }
  ck(Object.keys(d).join("|") === live.join("|"), "order " + n);
  let sum = 0;
  for (const k of live) {
    ck(d[k] === model[k], "get " + k);
    ck(k in d, "in " + k);
    ck(Object.prototype.hasOwnProperty.call(d, k), "hasOwn " + k);
    sum += d[k] as number;
  }
  for (let i = 0; i < n; i += 5) {
    const k = "key_" + i + "_" + ((i * 7919) % 1000) + "@s.whatsapp.net";
    if (!(k in model)) {
      ck(!(k in d), "gone " + k);
      ck(d[k] === undefined, "gone get " + k);
    }
  }
  ck(d["missing_key_zzz"] === undefined && !("missing_key_zzz" in d), "missing " + n);
  d["has_undef"] = undefined;
  ck("has_undef" in d && d["has_undef"] === undefined, "undefined value is present");
  console.log(n, live.length, sum, Object.keys(d).length);
}
// accessors and non-enumerables on a big table
{
  const d = mk();
  for (let i = 0; i < 40; i++) d["m" + i] = i;
  let reads = 0;
  Object.defineProperty(d, "acc", { get() { reads++; return 77; }, enumerable: true, configurable: true });
  Object.defineProperty(d, "hid", { value: 5, enumerable: false });
  ck(d.acc === 77 && d.acc === 77 && reads === 2, "getter on a big table");
  ck(d.hid === 5 && !Object.keys(d).includes("hid") && "hid" in d, "non-enumerable on a big table");
  for (let i = 40; i < 80; i++) d["m" + i] = i;
  ck(d.acc === 77 && d.hid === 5 && d.m79 === 79 && d.m0 === 0, "reads after growing past an accessor");
  delete d.m3;
  ck(d.m3 === undefined && d.m4 === 4 && d.acc === 77, "delete then read");
  console.log(Object.keys(d).slice(0, 6).join(), Object.keys(d).length, JSON.stringify(d).length);
}
// a table that grows past 65,535 members keeps answering
{
  const d = mk();
  const N = 70000;
  for (let i = 0; i < N; i++) d["x" + i] = i;
  let ok = true;
  for (let i = 0; i < N; i += 997) if (d["x" + i] !== i) ok = false;
  ck(ok && d["x69999"] === 69999 && d["x70000"] === undefined, "past 65535 members");
  delete d["x5"];
  ck(d["x5"] === undefined && d["x6"] === 6 && d["x69999"] === 69999, "past 65535 members after a delete");
}
console.log("checks", checks, "bad", bad);
