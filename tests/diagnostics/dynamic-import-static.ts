// import() of a builtin in a STATIC build: member calls and reads on the namespace are served natively, but using the namespace itself as
// a value (here a truthiness test, which Node accepts) is still a compile-time SC1090 per site until builtin namespaces as values land.
// Both sites are reported, poison-recovered.
async function run(): Promise<void> {
  const fs = await import("fs");
  console.log(fs ? "y" : "n");
  const p = await import("node:path");
  console.log(p ? "y" : "n");
}
run();
