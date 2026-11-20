// A literal-key read of a dyn object with 5 to 31 members may start from the position where the same key was found last time; the hint is
// only a starting point. Layouts that move the key (different insertion orders, deletes that shift it, a re-added key, an absent key, a
// key whose last position is past the end of a smaller table) must still answer exactly what a scan answers.
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
function rA(o: any): any {
  return o.alphaMember;
}
function rB(o: any): any {
  return o.betaMemberWithALongerName;
}
function rC(o: any): any {
  return o.gamma;
}
let total = 0;
for (let round = 0; round < 24; round++) {
  const n = 5 + ((round * 7) % 36);
  const d = mk();
  const model = new Map<string, number>();
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push("filler_" + i + "_" + round);
  // the three literal keys land at layout-dependent positions
  const pa = (round * 5) % n;
  const pb = (round * 7 + 3) % n;
  const pc = (round * 3 + 1) % n;
  const slots: string[] = names.slice();
  slots[pa] = "alphaMember";
  if (pb !== pa) slots[pb] = "betaMemberWithALongerName";
  if (pc !== pa && pc !== pb) slots[pc] = "gamma";
  slots.forEach((k, i) => {
    d[k] = i * 3 + round;
    model.set(k, i * 3 + round);
  });
  for (let rep = 0; rep < 3; rep++) {
    for (const [name, f] of [["alphaMember", rA], ["betaMemberWithALongerName", rB], ["gamma", rC]] as const) {
      const got = f(d);
      const want = model.get(name);
      ck(got === want, "read " + name + " round " + round + " rep " + rep + " got " + String(got) + " want " + String(want));
      total += got === undefined ? -1 : (got as number);
    }
    if (rep === 0) {
      // delete fillers before the keys: every position shifts by one
      for (let i = 0; i < n; i += 4) {
        const k = names[i]!;
        if (k in d) {
          delete d[k];
          model.delete(k);
        }
      }
    } else if (rep === 1) {
      delete d["alphaMember"];
      model.delete("alphaMember");
      d["gamma"] = 777 + round;
      model.set("gamma", 777 + round);
      d["alphaMember"] = 555 + round;
      model.set("alphaMember", 555 + round);
    }
  }
  // a table too small for the hint: the previous table's position is out of range
  const small = mk();
  for (let i = 0; i < 2; i++) small["s" + i] = i;
  small["gamma"] = round;
  ck(rC(small) === round, "small gamma " + round);
  ck(rA(small) === undefined, "small alpha " + round);
  // a big table that lacks the key entirely
  const lack = mk();
  for (let i = 0; i < 40; i++) lack["other_" + i] = i;
  ck(rA(lack) === undefined && rB(lack) === undefined && rC(lack) === undefined, "lack " + round);
}
console.log("checks " + checks + " bad " + bad + " total " + total);
