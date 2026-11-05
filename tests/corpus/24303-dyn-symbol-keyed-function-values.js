// Symbol-keyed properties on function values: each closure carries its own (the closure-callback idiom webidl2js generates), reads see it through every alias.
const wrapperSymbol = Symbol("wrapper");
function make(value) {
  const cb = function (x) { return x + 1; };
  cb[wrapperSymbol] = value;
  cb.objectReference = value;
  return cb;
}
const a = make("one"), b = make("two");
console.log(a(1), a[wrapperSymbol], b[wrapperSymbol], wrapperSymbol in a, Object.getOwnPropertySymbols(a).length);
const arrow = () => 5;
arrow[wrapperSymbol] = 9;
console.log(arrow[wrapperSymbol], arrow());
