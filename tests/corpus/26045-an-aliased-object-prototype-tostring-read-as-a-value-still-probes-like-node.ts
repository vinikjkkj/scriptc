// An Object.prototype.toString alias that is also read as a value keeps its function and still answers the class probe through .call.
const toStr = Object.prototype.toString;
function tag(x: unknown) { return toStr.call(x); }
const g = toStr;
console.log(tag([1]), tag(null), tag(1n));
console.log(typeof g);
