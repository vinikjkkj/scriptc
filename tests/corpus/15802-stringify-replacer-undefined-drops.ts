// A replacer answering undefined drops an object member and writes null in
// an array slot.
const dropped: unknown = { keep: 1, drop: 2, arr: [1, 2, 3], nest: { drop: 2, z: 0 } };
console.log(JSON.stringify(dropped, (k: string, v: unknown) => (v === 2 ? undefined : v)));
const wholeRoot: unknown = [1, undefined, 3];
console.log(JSON.stringify(wholeRoot, (k: string, v: unknown) => (v === 1 ? undefined : v)));
