// A function whose result is any[] (spelled or inferred) returns a dynamic array like Node.
const p: any = String.prototype;
const f = () => [p.a.call("x"), 1];
console.log(f().length);
