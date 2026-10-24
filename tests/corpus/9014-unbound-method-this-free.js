class T { free(x) { return x * 2 + 1; } }
const t = new T();
const h = t.free;
console.log(h(20));
class U { constructor() { this.v = 9; } plain() { return 'plain'; } }
const u = new U();
const p = u.plain;
console.log(p(), u.plain());
