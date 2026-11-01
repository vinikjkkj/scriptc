// A rejection whose reason is an intersection value, guarded after await.
type Retry = TypeError & { retry: boolean };
function isRetry(e: unknown): e is Retry {
  return e instanceof TypeError && typeof (e as unknown as { retry: unknown }).retry === 'boolean';
}
async function fail(): Promise<number> {
  const e = new TypeError('async') as Retry;
  e.retry = true;
  throw e;
}
async function main(): Promise<void> {
  try {
    await fail();
  } catch (e) {
    if (isRetry(e)) console.log(e.message, e.retry, e.name);
  }
}
main();
