// A number declared before the try and never written on the rejected path must
// keep its declared value after the try.
async function f(): Promise<void> {
  let n = 5;
  let s = 'init';
  try {
    await Promise.reject(new Error('keep'));
    n = 7;
    s = 'set';
  } catch (e: any) {
    console.log('caught keep', e.message);
  }
  console.log('after keep', n, s);
}
f();
