// process.stderr.write answers true and writes its string verbatim; the
// stdout stream is separate and both are compared byte for byte.
const r1 = process.stderr.write("stderr one\n");
console.log("r1:", r1);
const r2 = process.stderr.write("stderr two " + 2 + "\n");
console.log("r2:", r2);
