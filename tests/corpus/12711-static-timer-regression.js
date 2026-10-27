// The statically typed timer surface still answers exactly as before the dyn boxing.
const t = setTimeout(() => console.log("must not fire"), 1000);
console.log("static hasRef", t.hasRef());
t.unref();
console.log("static after unref", t.hasRef());
t.ref();
console.log("static after ref", t.hasRef());
const i = setImmediate(() => console.log("immediate ran"));
i.unref();
console.log("static immediate", i.hasRef());
clearTimeout(t);
