// A thenable whose then throws: the adopted promise rejects with the thrown
// value, and awaiting it rethrows that same value.
function adoptSlot(x: any): Promise<unknown> {
  return Promise.resolve(x);
}

async function main(): Promise<void> {
  const bad: any = {
    then() {
      throw new Error("then threw");
    },
  };
  await adoptSlot(bad).catch((e: unknown) => console.log("adopted rejected", (e as Error).message));
  try {
    await bad;
  } catch (e) {
    console.log("await rethrew", String(e));
  }
  console.log("main done");
}

main();
