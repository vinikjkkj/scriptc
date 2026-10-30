// Nested try with a finally around a rejected await: the number written by the
// finally and the one written by the outer catch both read back exactly.
async function f(): Promise<void> {
  let n = 1;
  try {
    try {
      await Promise.reject(new Error('deep'));
      n = 2;
    } finally {
      console.log('inner fin', n);
      n += 10;
    }
  } catch (e: any) {
    console.log('outer catch', e.message);
    n += 100;
  }
  console.log('after nested', n);
}
f();
