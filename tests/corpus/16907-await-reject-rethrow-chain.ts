// Inner catch rethrows into an outer catch; the write after the inner await
// must not run and the outer catch sees the rethrown error.
async function f(): Promise<void> {
  let flag = false;
  try {
    try {
      await Promise.reject(new Error('rethrow'));
      flag = true;
    } catch (e: any) {
      console.log('inner catch', e.message);
      throw e;
    }
  } catch (e: any) {
    console.log('outer catch', e.message);
  }
  console.log('after rethrow', flag);
}
f();
