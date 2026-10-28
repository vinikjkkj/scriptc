// static write, dyn write, static write land in source order on the same stream.
var outSlot: any = process.stdout;
process.stdout.write("static-1\n");
outSlot.write("dyn-2\n");
process.stdout.write("static-3\n");
console.log("after-console");
outSlot.write("dyn-5\n");
