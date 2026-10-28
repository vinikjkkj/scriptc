// The pgpass warn shape: a module-level var bound to process.stderr is
// written through a helper that reads its arguments into one line.
var warnStream = process.stderr;
function warn(...args: unknown[]): void {
  const parts = args.map((a) => String(a));
  warnStream.write(parts.join(" ") + "\n");
}
warn("WARNING:", "file", "has", 2, "problems");
warn("done");
