// A rejection whose reason is an intersection value, read after await.
async function fail(): Promise<number> {
  const e = new TypeError('async') as TypeError & { retry: boolean };
  e.retry = true;
  throw e;
}
async function main(): Promise<void> {
  try {
    await fail();
  } catch (e) {
    const x = e as TypeError & { retry: boolean };
    console.log(x.message, x.retry, x.name);
  }
}
main();
