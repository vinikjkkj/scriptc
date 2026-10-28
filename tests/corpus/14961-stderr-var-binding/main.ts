// A binding holds process.stderr (var, not a direct member access): the
// write goes to stderr through the bound stream.
var w = process.stderr;
w.write("bound write\n");
const r = w.write("bound again\n");
console.log("returned:", r);
