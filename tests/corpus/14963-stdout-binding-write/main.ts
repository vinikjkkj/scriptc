// The same binding shape on stdout: a var holding process.stdout writes
// to stdout, interleaved with console.log in call order.
var out = process.stdout;
console.log("line 1");
out.write("via binding\n");
console.log("line 2");
const ok = out.write("tail\n");
console.log("ok:", ok);
