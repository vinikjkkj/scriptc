// A bound stderr and console.error alternate: the two writes share the
// same stream in call order.
const err = process.stderr;
console.error("first console.error");
err.write("second via binding\n");
console.error("third console.error");
err.write("fourth via binding\n");
