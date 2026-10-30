// A promise rejected before a timer gap and awaited afterwards inside try: the
// flag read after the try must be the value written before the await.
async function f(): Promise<void> {
  let flag = false;
  const p: Promise<number> = Promise.reject(new Error('gap'));
  p.catch(() => undefined);
  await new Promise<void>((r) => setTimeout(r, 5));
  try {
    await p;
    flag = true;
  } catch (e: any) {
    console.log('caught gap', e.message);
  }
  console.log('after gap', flag);
}
f();
