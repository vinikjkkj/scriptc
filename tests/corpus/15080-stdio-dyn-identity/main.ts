// process.stderr boxed into a module slot keeps its identity in both directions.
var warnStream: any = process.stderr;
function warnTo(stream: any): any { const old = warnStream; warnStream = stream; return old; }
console.log("identity", warnTo(process.stderr) === process.stderr);
console.log("slot-is-stdout", warnStream === process.stderr, warnStream === process.stdout);
