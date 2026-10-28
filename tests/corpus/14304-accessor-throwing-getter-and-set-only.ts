// A throwing getter propagates through JSON.stringify as a catchable error; a set-only accessor is absent from JSON.
let log = 0;
function make(bad: boolean) {
  let size = 0;
  return {
    get v(): number { log++; if (bad) throw new Error("boom"); return size; },
    set only(x: number) { size = x; },
    add(): void { size++; },
  };
}
const ok = make(false);
ok.add();
const u: unknown = ok;
console.log(JSON.stringify(u));
console.log(log);
const bad = make(true);
const ub: unknown = bad;
try {
  console.log(JSON.stringify(ub));
} catch (e) {
  console.log("caught", (e as Error).message);
}
console.log(log);
