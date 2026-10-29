// JSON.stringify of a record whose bare `any` member holds undefined and a function: both keys are dropped, like Node.
interface Slot { label: string; value: any }
const kinds: unknown[] = [1, "s", true, null, undefined, [1, "x"], { k: { z: [2] } }, () => 3];
for (const k of kinds) {
  const s: Slot = { label: "a", value: k as any };
  console.log(JSON.stringify(s));
}
const plain: Slot = { label: "p", value: { n: 1, f: () => 2, u: undefined } };
console.log(JSON.stringify(plain));
console.log(JSON.stringify([plain, { label: "q", value: 9 }]));
