// Promise.all and Promise.allSettled over a non-iterable untyped argument: Node
// answers with a REJECTED promise (the iteration's TypeError), never a throw at
// the call. The rejection is caught by the awaiting function in both forms.
async function run(x: any): Promise<void> {
  try {
    await Promise.all(x);
    console.log("no failure");
  } catch (e) {
    console.log("caught", (e as Error).constructor.name);
  }
}
async function runSettled(x: any): Promise<void> {
  try {
    const r = await Promise.allSettled(x);
    console.log("settled", r.length);
  } catch (e) {
    console.log("caught settled", (e as Error).constructor.name);
  }
}
run(5);
runSettled(true);
console.log("sync end");
