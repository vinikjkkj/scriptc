// Promise.all over a promise that is still pending when the awaiter starts: the
// settle comes from a timer, and a chain started in that same turn logs first
// (Node reacts in a job, then resumes the awaiter one turn later).
let resolvePending: (v: string) => void = () => {};
const pending = new Promise<string>((resolve) => {
  resolvePending = resolve;
});

async function run(): Promise<void> {
  await Promise.all([pending]);
  console.log("pending all done");
}

run();
setTimeout(() => {
  resolvePending("x");
  Promise.resolve("r1")
    .then((v) => console.log("chain", v))
    .then(() => console.log("chain two"));
}, 10);
