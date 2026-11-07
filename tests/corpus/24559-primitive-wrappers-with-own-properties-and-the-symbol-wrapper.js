// Wrapper objects made by Object(x) behave as objects: they take own properties (`Object("ab").x = 1`), print them after the wrapper
// (`[String: 'ab'] { x: 1 }`), list them in Object.keys after a string wrapper's indices, and stringify as the primitive. A Symbol wrapper
// is typeof "object", prints `[Symbol: Symbol(d)]`, reads `description` and answers its symbol from valueOf and toString.
function mk(v) { return Object(v); }
const w = mk("ab"); w.x = 1;
const n = mk(5); n.tag = "t";
console.log(w, n, [w], Object.keys(w).join(), Object.keys(n).join(), JSON.stringify(w), w.x, n.tag);
const sym = Symbol("d");
const sw = mk(sym);
console.log(typeof sw, sw, sw.description, sw.toString(), sw.valueOf() === sym);
