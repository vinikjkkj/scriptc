// The sql-escaper shape: an `object` parameter narrowed by `v is Record<K, unknown>` after an own-key guard, then read through a unique-symbol key. The static record
// type has no storage for a symbol key, so the read goes to the value's own symbol table: true for the marked object, false for an unmarked, wrongly-marked or foreign one.
const MARK: unique symbol = Symbol.for("demo.mark");
function isOwn<K extends PropertyKey>(v: object, k: K): v is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(v, k);
}
function isMark(value: object): boolean {
  return isOwn(value, MARK) && value[MARK] === true;
}
const marked = Object.create(null) as any;
marked[MARK] = true;
marked.value = 3;
const wrong: any = {};
wrong[MARK] = 1;
const plain: any = { value: 1 };
console.log(isMark(marked), isMark(wrong), isMark(plain), isMark({}), isMark([1]), isMark(Object.create(null)));
marked[MARK] = false;
console.log(isMark(marked));
