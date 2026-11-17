// The same `.call` spelling over a pure index-signature record and a record of required fields keeps answering as before.
const hop = Object.prototype.hasOwnProperty;
type HeaderBag = Readonly<Record<string, string>>;
type Req = { id: number; name: string };
function has(h: HeaderBag, k: string): boolean { return hop.call(h, k); }
const h: HeaderBag = { "content-type": "text/plain", accept: "*/*" };
const r: Req = { id: 1, name: "n" };
console.log(has(h, "accept"), has(h, "x-missing"), hop.call(r, "id"), hop.call(r, "nope"));
const keys: string[] = [];
for (const key in h) if (hop.call(h, key)) keys.push(key);
console.log(keys.join(","));
