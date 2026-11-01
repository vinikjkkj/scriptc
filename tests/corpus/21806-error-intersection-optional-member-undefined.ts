// An optional refinement member reads undefined when no write happened, and its value when one did.
type Opt = Error & { hint?: string; count?: number };
const e = new Error('opt') as Opt;
console.log(e.hint === undefined, e.count === undefined, e.message);
e.hint = 'retry';
console.log(e.hint, e.count === undefined);
const f = new TypeError('typed') as Opt;
console.log(f.hint ?? 'none', f.name);
