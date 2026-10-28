// process.stderr.write and console.error on the same stream, interleaved:
// each write lands in call order.
console.error("error 1");
process.stderr.write("write 1\n");
console.error("error 2", 42);
process.stderr.write("write 2\n");
console.log("stdout line");
