// A thenable that settles more than once: only the first resolve or reject
// counts, and a later throw from then is swallowed once a resolve ran.
function adoptSlot(x: any): Promise<unknown> {
  return Promise.resolve(x);
}

async function main(): Promise<void> {
  const twice: any = {
    then(resolve: (v: unknown) => void, reject: (r: unknown) => void) {
      resolve("first");
      resolve("second");
      reject("late reason");
      throw new Error("after settle");
    },
  };
  console.log("value", await adoptSlot(twice));
  console.log("main done");
}

main();
