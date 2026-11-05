"use strict";
// webidl2js's wrapper <-> impl pair: two objects holding each other under symbol keys. A cycle the cycle collector reclaims (no GC); the pairs are discarded every iteration.
const wrapperSymbol = Symbol("wrapper");
const implSymbol = Symbol("impl");
const utils = { wrapperSymbol, implSymbol };
function mk() { return Object.create(null); }
function wrapperForImpl(impl) { return impl ? impl[utils.wrapperSymbol] : null; }
function implForWrapper(wrapper) { return wrapper ? wrapper[utils.implSymbol] : null; }
function setup(id) {
  const wrapper = mk();
  Object.defineProperty(wrapper, implSymbol, { value: mk(), configurable: true });
  wrapper[implSymbol][wrapperSymbol] = wrapper;
  wrapper[implSymbol].id = id;
  return wrapper;
}
let sum = 0;
let kept = null;
for (let n = 0; n < 20000; n++) {
  const w = setup(n);
  if (wrapperForImpl(implForWrapper(w)) !== w) throw new Error("lost the back edge");
  sum += implForWrapper(w).id;
  if (n === 777) kept = w;
}
console.log(sum, implForWrapper(kept).id, wrapperForImpl(implForWrapper(kept)) === kept);
console.log(kept);
console.log(Object.keys(kept), JSON.stringify(implForWrapper(kept)));
