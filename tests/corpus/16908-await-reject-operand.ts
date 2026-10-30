// An await used as an operand of a larger expression, rejected: the assignment
// that would have used its value must not happen.
async function f(): Promise<void> {
  let x = 5;
  const p: Promise<number> = Promise.reject(new Error('operand'));
  try {
    x = 1 + (await p);
  } catch (e: any) {
    console.log('caught operand', e.message);
  }
  console.log('after operand', x);
}
f();
