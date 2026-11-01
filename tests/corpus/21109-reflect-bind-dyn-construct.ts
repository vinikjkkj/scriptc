// A bind whose result lands in an any slot is bound at run time. Its [[Construct]]
// runs the target with the bound arguments and ignores the bound receiver, and a
// bound arrow is not a constructor.
function pair(a: number, b: number): number[] {
  return [a, b];
}
const B: any = pair.bind(null, 5);
const made: any = new B(7);
console.log(typeof made, made[0], made[1]);
const viaReflect: any = Reflect.construct(B, [8]);
console.log(viaReflect[0], viaReflect[1]);

const obj = {
  t: 7,
  m(this: { t: number }, x: number): number {
    return this.t + x;
  },
};
const bm: any = obj.m.bind({ t: 100 }, 1);
console.log(bm(), bm(5));

const exp: any = {};
const buf: number[] = [0, 0, 0, 0];
function write(o: number[], off: number, v: number): void {
  o[off] = v;
}
exp.write = write.bind(null, buf, 1);
exp.write(9);
console.log(buf[1], typeof exp.write);

const arrow = (x: number): number => x;
const BA: any = arrow.bind(null, 1);
try {
  new BA();
  console.log("constructed");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
