// A promise from an async function that throws, awaited inside try after an
// assignment: the pre-await write is what the catch path and the read see.
async function fail(): Promise<number> {
  throw new Error('later');
}
async function f(): Promise<void> {
  let flag = false;
  try {
    const p = fail();
    flag = false;
    await p;
    flag = true;
  } catch (e: any) {
    console.log('caught later', e.message);
  }
  console.log('after later', flag);
}
f();
