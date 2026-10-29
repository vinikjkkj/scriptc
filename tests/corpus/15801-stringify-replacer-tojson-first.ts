// toJSON runs BEFORE the replacer: the replacer sees the hook's answer and
// the key the hook received.
const withJ: unknown = { x: 1, toJSON(k: string): unknown { return { seen: k, y: 2 }; } };
console.log(JSON.stringify(withJ, (k: string, v: unknown) => (k === "y" ? 99 : v)));
const nested: unknown = { inner: { toJSON(k: string): unknown { return "key=" + k; } } };
console.log(JSON.stringify(nested, (k: string, v: unknown) => v));
