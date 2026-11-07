// A String/Number/Boolean wrapper object built through a constructor VALUE cannot be bound to a variable: the wrapper interface maps
// to the primitive, so the binding is refused at the build instead of throwing at run time.
const m = { n: Number };
const w = new m.n(3);
console.log(typeof w);
