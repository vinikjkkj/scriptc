// A plain thenable, untyped: its then runs in a job of its own (not during the
// call that adopts it), and the awaiter gets the value resolve passes.
function adoptSlot(x: any): Promise<unknown> {
  return Promise.resolve(x);
}

async function main(): Promise<void> {
  const plain: any = {
    then(resolve: (v: unknown) => void) {
      console.log("then called");
      resolve(42);
    },
  };
  console.log("before adopt");
  const p = adoptSlot(plain);
  console.log("after adopt");
  console.log("value", await p);
  console.log("await direct", await plain);
  console.log("main done");
}

main();
