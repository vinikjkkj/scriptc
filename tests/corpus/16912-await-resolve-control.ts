// Control: a resolved await takes the normal path and the write is visible.
async function f(): Promise<void> {
  let flag = false;
  let n = 0;
  try {
    await Promise.resolve(1);
    flag = true;
    n = 3;
  } catch (e: any) {
    console.log('caught resolve');
  }
  console.log('after resolve', flag, n);
}
f();
