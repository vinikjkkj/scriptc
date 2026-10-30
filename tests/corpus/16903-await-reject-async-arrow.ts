// Async arrow function: rejected await inside try, flag read after the try.
const g = async (): Promise<void> => {
  let flag = false;
  try {
    await Promise.reject(new Error('arrow'));
    flag = true;
  } catch (e: any) {
    console.log('caught arrow', e.message);
  }
  console.log('after arrow', flag);
};
g();
