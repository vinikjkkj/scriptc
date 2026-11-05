// String(x) over a (string | symbol) element answers "Symbol(desc)" for the symbol arm, as Node does; only an implicit conversion throws.
const arr = ["a", Symbol("b")];
console.log(arr.map((k) => String(k)), arr.map((k) => typeof k === "symbol" ? 1 : 0));
