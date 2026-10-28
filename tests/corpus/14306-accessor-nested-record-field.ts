// An accessor record nested as a data record field crosses with its getter live.
// an accessor record nested as a field of a data record crossing to unknown
function make(max: number) {
  let size = 0;
  return { get available(): number { return max - size; }, size2: 9 };
}
const outer = { name: "wrap", inner: make(4), extra: [1, 2] };
const u: unknown = outer;
console.log(JSON.stringify(u));
console.log(u);
