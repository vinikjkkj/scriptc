type Ops = { cb: (x: number) => number };
function build(flag: boolean): Ops {
  const o: Ops = { cb: flag ? (x: number) => x + 1 : function (x: number) { return x * 2; } };
  return o;
}
console.log(build(true).cb(3), build(false).cb(3));
