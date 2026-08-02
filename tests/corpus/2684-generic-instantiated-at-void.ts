// A generic instantiated at VOID -- the ordinary "task that just does work"
// shape. Binding inference used to skip a void argument, leaving the type
// parameter UNBOUND, and the body then fenced on a `T` nothing could resolve
// (`Promise<T>` has no value type, `.finally` has no lowering) even though the
// call site was perfectly concrete.
//
// Void binds like any other argument now: the return flows, `Promise<T>` is
// `Promise<void>`, and a VALUE position meets the same void fence it would
// with the type spelled out.
type Task<T> = () => Promise<T>;

class Gate {
  private active = 0;
  public run<T>(task: Task<T>): Promise<T> {
    this.active += 1;
    const current: Promise<T> = task();
    return current.finally(() => {
      this.active -= 1;
    });
  }
  public depth(): number {
    return this.active;
  }
}

async function twice<T>(task: Task<T>): Promise<T> {
  await task();
  return task();
}

// A defaulted parameter that defaults TO void.
async function maybe<T = void>(task: Task<T>): Promise<T> {
  return task();
}

const g = new Gate();
let sideEffects = 0;

async function main(): Promise<void> {
  // The same generic at a value type and at void, so both instances exist.
  console.log(await g.run(async () => 7));
  await g.run(async () => {
    sideEffects += 1;
  });
  console.log(sideEffects, g.depth());

  // An EXPLICIT void type argument.
  await g.run<void>(async () => {
    sideEffects += 1;
  });
  console.log(sideEffects);

  // A void instance of a plain generic function, and a value one beside it.
  console.log(await twice(async () => "v"));
  await twice(async () => {
    sideEffects += 1;
  });
  console.log(sideEffects);

  await maybe(async () => {
    sideEffects += 1;
  });
  console.log(sideEffects, await maybe(async () => 3));
}

void main();
