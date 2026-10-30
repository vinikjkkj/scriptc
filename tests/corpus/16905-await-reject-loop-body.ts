// A rejected await inside a loop body within try: the counter written after
// each await must stay at its pre-loop value on the catch path.
async function f(): Promise<void> {
  let n = 0;
  try {
    for (let i = 0; i < 3; i++) {
      await Promise.reject(new Error('L' + i));
      n++;
    }
  } catch (e: any) {
    console.log('caught loop', e.message);
  }
  console.log('after loop', n);
}
f();
