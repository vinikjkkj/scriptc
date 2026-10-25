// An untyped value in a Promise-or-undefined slot: a promise is adopted as
// itself, and undefined stays undefined (it is not a promise of undefined).
function lookup(fake: any, key: string): Promise<unknown> | undefined {
  return fake.get(key);
}

async function main(): Promise<void> {
  const fake = {
    get: (key: string) => (key === "some" ? Promise.resolve(7) : undefined),
  };
  const found = lookup(fake, "some");
  console.log("found is undefined", found === undefined);
  console.log("found value", found === undefined ? "none" : await found);
  const missing = lookup(fake, "none");
  console.log("missing is undefined", missing === undefined);
  console.log("main done");
}

main();
