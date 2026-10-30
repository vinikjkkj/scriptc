// try/finally without a catch around a rejected await: the finally reads the
// flag, and the rejection propagates to the caller.
async function f(): Promise<void> {
  let flag = false;
  try {
    await Promise.reject(new Error('nocatch'));
    flag = true;
  } finally {
    console.log('fin nocatch', flag);
  }
}
f().catch((e: any) => console.log('top nocatch', e.message));
