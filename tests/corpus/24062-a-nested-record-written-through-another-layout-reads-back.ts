// A nested record member written through a callee that sees another layout reads back at the caller.
interface InB { v: number }
interface InW { name: string; v: number }
interface Base { inner: InB; k: number }
interface Wide { z: string; k: number; inner: InW }
function bump(o: Base): void { o.inner.v += 10; o.k += 1; }
const w: Wide = { z: "z", k: 1, inner: { name: "i", v: 1 } };
bump(w);
console.log(w.k, w.inner.v, w.inner.name);
