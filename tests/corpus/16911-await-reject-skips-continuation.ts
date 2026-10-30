// The statement after a rejected await inside try is skipped entirely.
async function f(): Promise<void> {
  try {
    await Promise.reject(new Error('skip'));
    console.log('CONTINUATION must not print');
  } catch (e: any) {
    console.log('caught skip', e.message);
  }
  console.log('after skip');
}
f();
