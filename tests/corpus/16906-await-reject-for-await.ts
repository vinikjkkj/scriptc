// for await over an async generator that throws: the flag set after the loop
// must not be set when the loop throws.
async function* gen(): AsyncGenerator<number> {
  yield 1;
  throw new Error('gen');
}
async function f(): Promise<void> {
  let flag = 'no';
  try {
    for await (const v of gen()) {
      console.log('value', v);
    }
    flag = 'yes';
  } catch (e: any) {
    console.log('caught gen', e.message);
  }
  console.log('after gen', flag);
}
f();
