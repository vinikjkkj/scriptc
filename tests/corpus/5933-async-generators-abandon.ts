// Abandoning a `for await` by RETURN or THROW from the consumer, not by
// `break`. Node closes the iterator in all three cases (IteratorClose is
// part of the loop's abrupt-completion handling, not of `break`), so the
// generator's `finally` runs before the consumer's frame unwinds.
//
// The synchronous controls are here in the same program on purpose: if the
// async lane were to diverge, this program says whether the sync lane
// diverges the same way (a shared desugar gap) or whether the async lane
// invented a new one.
async function* agen(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    yield 2;
  } finally {
    console.log("agen: finally");
  }
}

function* sgen(): Generator<number, void, void> {
  try {
    yield 1;
    yield 2;
  } finally {
    console.log("sgen: finally");
  }
}

async function aRet(): Promise<string> {
  for await (const v of agen()) {
    return "aret:" + v;
  }
  return "anone";
}

async function aThrow(): Promise<void> {
  for await (const v of agen()) {
    throw new Error("aboom:" + v);
  }
}

function sRet(): string {
  for (const v of sgen()) {
    return "sret:" + v;
  }
  return "snone";
}

function sThrow(): void {
  for (const v of sgen()) {
    throw new Error("sboom:" + v);
  }
}

async function main(): Promise<void> {
  console.log(await aRet());
  try {
    await aThrow();
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  console.log(sRet());
  try {
    sThrow();
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
}

main();
