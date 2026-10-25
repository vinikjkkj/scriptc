// A promise rejected with values that are not Errors: a string, a number, an
// object and undefined. Each reaches catch with the same identity and type,
// await rethrows the same value, and a reject after resolve does nothing.
function failWith(reason: unknown): Promise<number> {
  return new Promise<number>((_resolve, reject) => {
    reject(reason);
  });
}

async function rethrowsAsIs(): Promise<void> {
  await failWith("thrown");
}

async function main(): Promise<void> {
  await failWith("text").catch((e: unknown) => console.log("string reason", e));
  await failWith(42).catch((e: unknown) => console.log("number reason", e));
  const payload = { code: 7 };
  await failWith(payload).catch((e: unknown) => console.log("object reason", JSON.stringify(e)));
  await failWith(undefined).catch((e: unknown) => console.log("undefined reason", e));
  const late = new Promise<number>((resolve, reject) => {
    resolve(1);
    reject("ignored");
  });
  console.log("late", await late);
  await rethrowsAsIs().catch((e: unknown) => console.log("await rethrow", e));
  console.log("main done");
}

main();
