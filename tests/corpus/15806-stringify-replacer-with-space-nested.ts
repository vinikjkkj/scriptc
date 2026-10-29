// A replacer and a gap together: the gap applies at each nesting level and
// the replacer sees every position.
const deep: unknown = { l1: { l2: { l3: [[], {}, [1]] } } };
console.log(JSON.stringify(deep, (k: string, v: unknown) => v, 2));
const n = 3;
console.log(JSON.stringify({ q: [1, 2], w: {} }, (k: string, v: unknown) => (k === "w" ? undefined : v), n));
