// Ordering of a thenable's job against a native promise's reaction: the job
// that calls then is queued when the thenable is adopted, so it runs before a
// reaction queued after it, and the adopted promise's reaction runs after the
// job's resolve.
function adoptSlot(x: any): Promise<unknown> {
  return Promise.resolve(x);
}

const thenable: any = {
  then(resolve: (v: unknown) => void) {
    console.log("thenable then");
    resolve("t");
  },
};

const native = Promise.resolve("n");
const adopted = adoptSlot(thenable);
native.then(() => console.log("native reaction"));
adopted.then(() => console.log("thenable reaction"));
console.log("armed");
