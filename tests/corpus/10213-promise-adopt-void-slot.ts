// An untyped value flowing into a Promise<void> slot: the untyped promise is
// adopted, and a plain value is a promise fulfilled with it. Awaiting the
// adopted promise waits for the work and never throws for the value.
function send(fake: any, d: boolean): Promise<void> {
  return fake.ensure(d) ?? Promise.resolve();
}

async function main(): Promise<void> {
  const fake = {
    ensure: (d: boolean) => (d ? Promise.resolve("work") : 5),
  };
  await send(fake, true);
  console.log("sent true");
  await send(fake, false);
  console.log("sent false");
  await Promise.all([send(fake, true), send(fake, false)]);
  console.log("main done");
}

main();
