// When every entry rejects (or the iterable is empty), Promise.any rejects with an AggregateError: message "All promises were rejected" and an `errors`
// array holding each reason in INPUT order, whatever order they rejected in. `new AggregateError` and `.errors` had no lowering.
async function failAfter(ms: number, why: string): Promise<number> {
  await new Promise<void>((r) => setTimeout(r, ms));
  throw new Error(why);
}
async function failText(): Promise<number> { throw "text reason"; }

async function main(): Promise<void> {
  try {
    await Promise.any([failAfter(5, "slow"), failAfter(1, "fast"), failText()]);
  } catch (e) {
    console.log(String(e), e instanceof AggregateError, e instanceof Error);
    if (e instanceof AggregateError) {
      console.log(e.name, e.message, e.errors.length);
      console.log(e.errors.map((x: unknown) => String(x)).join(" | "));
    }
  }
  await Promise.any([failAfter(1, "only")]).catch((e) => console.log("catch cb", String(e), (e as AggregateError).errors.length));
  const none: Promise<number>[] = [];
  await Promise.any(none).catch((e) => console.log("empty", String(e), (e as AggregateError).errors.length));
  const pending: Promise<number>[] = [failAfter(2, "p1"), Promise.resolve(8), failAfter(1, "p2")];
  console.log(await Promise.any(pending));
  console.log(await Promise.any([failAfter(1, "a"), 9]));
  const mixed: Promise<number | string>[] = [failAfter(1, "m1"), Promise.resolve("text")];
  console.log(await Promise.any(mixed));
  const results = await Promise.allSettled([Promise.any([failAfter(1, "z")]), Promise.any([Promise.resolve(1)])]);
  console.log(results.map((r) => r.status).join(","));
}
main().then(() => console.log("done"));
