// Runs ~750 ms with an idle seam every 25 ms, and every tick keeps a fresh 1 MB string (written, so its pages fault in): far more minor
// faults between seams than the default fault budget, while the timer interval is set so far out that only the fault trigger can repeat the drop.
const keep: string[] = [];
let n = 0;
const t = setInterval(() => {
  keep.push("y".repeat(1_000_000));
  n++;
  if (n === 30) {
    clearInterval(t);
    console.log("done", n, keep.length);
  }
}, 25);
