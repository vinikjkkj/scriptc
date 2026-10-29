// JSON.stringify(value, replacer) over an unknown root: the replacer sees the
// root under key "" first, then every member and element, in JS order.
const data: unknown = { a: 1, b: [10, "s", null, true], c: { d: "x" } };
const seen: string[] = [];
const out = JSON.stringify(data, (k: string, v: unknown) => {
  seen.push(k + ":" + typeof v);
  return v;
});
console.log(out);
console.log(seen.join(" "));
