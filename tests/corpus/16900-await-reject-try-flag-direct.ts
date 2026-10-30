// An await of an already-rejected promise must transfer control to the catch
// before the statement after it: the flag assigned after the await stays false
// on the catch path, and the read after the try sees it.
async function b(): Promise<void> {
  let flag = false;
  try {
    await Promise.reject(new Error('x'));
    flag = true;
  } catch (e: any) {
    console.log('caught b', e.message);
  } finally {
    console.log('fin b', flag);
  }
  console.log('after b', flag);
}
b();
