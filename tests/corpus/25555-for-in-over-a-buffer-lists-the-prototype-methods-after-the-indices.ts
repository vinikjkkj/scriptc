// A Buffer inherits the enumerable methods of Buffer.prototype, so for-in lists them after its indices; a plain Uint8Array does not.
function keys(x: any): string { const out: string[] = []; for (const k in x) out.push(k); return out.join(","); }
const b: any = Buffer.from("ab");
const ks = keys(b);
console.log(ks.length, ks.slice(0, 40), ks.slice(-20));
console.log(keys(new Uint8Array(2)), keys(Buffer.alloc(0)).length);
let n = 0; for (const k in b) { if (k === "toString") n++; } console.log(n);
const typed = Buffer.from("xyz"); const tk: string[] = []; for (const k in typed) tk.push(k);
console.log(tk.length, tk.slice(0, 5).join(","), tk[tk.length - 1]);
