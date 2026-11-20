// A hoisted JavaScript alias of Object.prototype.toString answers the class tag through .call like Node.
var objectToString = Object.prototype.toString;
function tag(v) { return objectToString.call(v); }
console.log(tag([]), tag(null), tag(function () {}), tag(new Date(0)), tag(1), tag("s"), tag(undefined));
