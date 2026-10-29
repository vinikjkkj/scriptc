// A program-authored bare `any` record member (the native ScrDyn slot): every JS kind written and read back,
// a stored function called, JSON.stringify and console.log of the containing record.
interface Slot { label: string; value: any }
const s: Slot = { label: "a", value: 1 };
console.log(typeof s.value);
const kinds: unknown[] = [0, -2.5, "str", true, false, null, undefined, [1, "x"], { k: 1 }];
for (const k of kinds) {
  s.value = k;
  console.log(typeof s.value, s.value === k, String(s.value), JSON.stringify(s));
}
s.value = () => 7;
console.log(typeof s.value, s.value(), JSON.stringify(s));
s.value = (x: number) => x * 3;
console.log(s.value(5));
s.value = { nested: [1, 2, { deep: "d" }] };
console.log(JSON.stringify(s), JSON.stringify(s.value));
console.log(s);
console.log(s.value.nested[2].deep);
