// A third value type under the string-keyed view, and a number-keyed instantiation that must NOT join it: a call through
// `Box<number, unknown>` dispatches to the number-keyed class, a call through `Box<string, unknown>` to whichever string-keyed one.
class Box<K, V> {
  readonly seen: K[] = [];
  value: V;
  constructor(value: V) { this.value = value; }
  note(key: K): string { this.seen.push(key); return typeof key + ":" + String(key) + "#" + this.seen.length; }
  last(): string { return this.seen.length === 0 ? "none" : String(this.seen[this.seen.length - 1]); }
}
class Rec { readonly id: number; constructor(id: number) { this.id = id; } }
const strRec = new Box<string, Rec>(new Rec(1));
const strNum = new Box<string, number>(7);
const strBool = new Box<string, boolean>(true);
const numRec = new Box<number, Rec>(new Rec(2));
const numStr = new Box<number, string>("s");
function byString(i: number): Box<string, unknown> { return i === 0 ? strRec : i === 1 ? strNum : strBool; }
function byNumber(first: boolean): Box<number, unknown> { return first ? numRec : numStr; }
console.log(byString(0).note("a"), byString(1).note("b"), byString(2).note("c"), byString(0).note("d"));
console.log(byNumber(true).note(1), byNumber(false).note(2.5), byNumber(true).note(3));
console.log(strRec.last(), strNum.last(), strBool.last(), numRec.last(), numStr.last());
console.log(strRec.value.id, strNum.value + 1, strBool.value, numRec.value.id, numStr.value);
console.log(byString(2) === strBool, byNumber(false) === numStr);
