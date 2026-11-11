// A Promise.any whose entries all reject, awaited with no handler: the AggregateError is unhandled, so the process exits with code 1 after the output so far.
async function main(): Promise<void> {
  console.log("start");
  await Promise.any([Promise.reject(new Error("a")), Promise.reject("b")]);
  console.log("not reached");
}
main();
