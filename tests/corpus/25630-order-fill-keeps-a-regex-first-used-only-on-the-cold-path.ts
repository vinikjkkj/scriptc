// The profiling run (COLD unset) never builds a regex; COLD=1 does, so the engine code it needs is not in the profile's order.
const cold = process.env.COLD === "1";
const lines = ["alpha 12", "beta 7", "gamma 301", "delta x"];
let sum = 0; const tags: string[] = [];
for (const l of lines) {
  if (cold) { const m = /^(\w+) (\d+)$/.exec(l); if (m) { sum += Number(m[2]); tags.push(m[1]!.toUpperCase()); } }
  else sum += l.length;
}
console.log(sum, tags.join(","));
