// A promise forwarding its source through then(resolve, reject): the executor's
// own resolve and reject are the handlers. A fulfilled source resolves the
// forwarder; a rejected source rejects it with the same (non-Error) reason.
function forward(source: Promise<string>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    source.then(resolve, reject);
  });
}

const fine = new Promise<string>((resolve) => {
  setTimeout(() => resolve("fine"), 5);
});
const broken = new Promise<string>((_resolve, reject) => {
  setTimeout(() => reject("late string"), 20);
});

async function main(): Promise<void> {
  forward(fine).then((v) => console.log("forwarded", v));
  await forward(broken).catch((e) => console.log("forward reject", e));
  console.log("main done");
}

main();
