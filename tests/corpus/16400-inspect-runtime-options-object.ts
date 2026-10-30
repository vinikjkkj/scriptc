// util.inspect options that arrive as RUNTIME objects (JSON.parse), on static
// and checked-dynamic values: breakLength, compact (false / a number), the
// maxArrayLength and maxStringLength caps, numericSeparator, sorted, depth.
import util from "node:util";

const obj = { a: 1, b: "two", c: [1, 2, 3], d: { e: { f: { g: 1 } } } };
const arr: number[] = Array.from({ length: 120 }, (_, i) => i);
const text = "x".repeat(20) + "\n" + "y".repeat(30);
const dyn: any = { b: 2, a: 1, c: [3, 1], nested: { z: [1, 2, 3, 4, 5, 6, 7, 8], y: "q" } };
const dynNums: any = [1234567, 2, 3, 1e-7];

const opts = [
  '{"breakLength": 20}',
  '{"compact": false}',
  '{"compact": 1}',
  '{"compact": 5, "breakLength": 40}',
  '{"maxArrayLength": 3}',
  '{"maxArrayLength": null}',
  '{"maxStringLength": 10}',
  '{"numericSeparator": true}',
  '{"sorted": true}',
  '{"depth": 0, "unknownKey": 5}',
  '{"depth": null}',
];
for (const text_ of opts) {
  const o = JSON.parse(text_);
  console.log(`== ${text_}`);
  console.log(util.inspect(obj, o));
  console.log(util.inspect(arr, o));
  console.log(util.inspect(text, o));
  console.log(util.inspect(dyn, o));
  console.log(util.inspect(dynNums, o));
}
console.log(util.inspect(obj, undefined));
console.log(util.inspect(obj, null as any));
console.log(util.inspect(obj));
