// A promise rejected synchronously by its executor, awaited inside try.
async function f(): Promise<void> {
  let flag = false;
  try {
    await new Promise<number>((_res, rej) => rej(new Error('ctor')));
    flag = true;
  } catch (e: any) {
    console.log('caught ctor', e.message);
  }
  console.log('after ctor', flag);
}
f();
