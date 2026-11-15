// A closure with no captures that is boxed as a function value and released while something else still holds it is buffered as a candidate
// cycle root only if the closure's own release would buffer it: otherwise its later teardown skips the unbuffering and the buffer lists a freed
// object. The thrown-and-caught error at the end walks the root buffer at its own release (exit teardown), which is where a stale entry shows.
const log: string[] = [];
function run(label: string, f: any): void {
  try {
    log.push(label + " " + String(f()));
  } catch (e) {
    log.push(label + " THREW " + (e as Error).message);
  }
}
const keep: any[] = [];
function leaf(): any {
  return () => 7;
}
for (let i = 0; i < 40; i++) {
  const f = leaf();
  keep.push(f);
  keep.pop();
}
run("a", () => 1);
run("b", () => {
  throw new Error("x");
});
run("c", leaf());
console.log(log.join("|"));
