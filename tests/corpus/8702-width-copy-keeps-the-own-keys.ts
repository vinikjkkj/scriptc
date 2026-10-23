// A value that flows into a record type with the same members but wider
// member types is COPIED, and the copy has to own exactly the members the
// source owned: a member that was explicitly undefined stays an own key, and
// one that was never there stays absent.
interface N {
  id: number;
  note?: string;
  n?: number;
}
interface M {
  id: number | string;
  note?: string;
  n?: number | boolean;
}
const describe = (m: M): void => {
  console.log(m, Object.keys(m), JSON.stringify(m), "note" in m, "n" in m);
};
const w1: N = { id: 1, note: undefined, n: 5 };
const w2: N = { id: 2, n: 5 };
const w3: N = { id: 3 };
describe(w1);
describe(w2);
describe(w3);
const arr: M[] = [w1, w2, w3];
console.log(arr);
console.log(arr.map((e) => Object.keys(e).join("|")));
const picked: M = process.argv.length > 99 ? w1 : w2;
console.log(picked, Object.hasOwn(picked, "note"), Object.hasOwn(picked, "n"));
