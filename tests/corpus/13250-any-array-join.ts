// join on an any[] (dyn-element array): every element kind joins like Array.prototype.join.
const a: any[] = [1, "x", true, null, undefined, 2.5, false, "", -0];
console.log(a.join("-"));
console.log(a.join());
console.log(a.join(""));
const empty: any[] = [];
console.log(JSON.stringify(empty.join(",")));
const one: any[] = ["solo"];
console.log(one.join(" | "));
function build(n: number): any[] {
  const out: any[] = [];
  for (let i = 0; i < n; i++) out.push(i % 2 === 0 ? i : "s" + i);
  return out;
}
console.log(build(6).join("+"));
