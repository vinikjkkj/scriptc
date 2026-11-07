// `recv?.["name"](args)`: the optional chain over an element-access call with a string-literal key, on a record,
// on a class instance and through a const key. An absent receiver short-circuits (arguments not evaluated).
interface Runner {
  run(n: number): string;
  count: number;
}
class Box {
  items = 0;
  add(by: number): number {
    this.items += by;
    return this.items;
  }
}
const NAME = "run";
function maybeRunner(on: boolean): Runner | undefined {
  return on ? { run: (n) => "ran" + n, count: 2 } : undefined;
}
function maybeBox(on: boolean): Box | undefined {
  return on ? new Box() : undefined;
}

let evaluated = 0;
const r = maybeRunner(true);
const none = maybeRunner(false);
console.log(r?.["run"](1), none?.["run"]((evaluated += 1, 2)), evaluated);
console.log(r?.[NAME](3), none?.[NAME](4));
const b = maybeBox(true);
const nb = maybeBox(false);
console.log(b?.["add"](5), b?.["add"](6), nb?.["add"]((evaluated += 10, 1)), evaluated);
console.log(r?.["count"], none?.["count"]);
