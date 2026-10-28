// A function-local binding of process.stderr writes through the value
// (the const/var forms both reach the same stream write).
function emit(label: string): boolean {
  const s = process.stderr;
  return s.write("emit " + label + "\n");
}
console.log("a:", emit("a"));
console.log("b:", emit("b"));
