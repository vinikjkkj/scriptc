// The awaited value is bound by const: on rejection the binding is never
// reached, so the flag after the try stays false.
async function f(): Promise<void> {
  let flag = false;
  const p: Promise<number> = Promise.reject(new Error('bind'));
  try {
    const r: number = await p;
    flag = true;
    console.log('bound', r);
  } catch (e: any) {
    console.log('caught bind', e.message);
  }
  console.log('after bind', flag);
}
f();
