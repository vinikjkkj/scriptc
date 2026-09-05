// An async override that THROWS. The throw must settle the returned promise
// as REJECTED — it must not escape synchronously at the call site, which is
// what a vtable entry pointing at the raw body would do.
class Base {
  async run(): Promise<number> {
    return 1;
  }
}
class Boom extends Base {
  override async run(): Promise<number> {
    throw new Error('boom');
  }
}
class LateBoom extends Base {
  override async run(): Promise<number> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1);
    });
    throw new Error('late boom');
  }
}
async function main(): Promise<void> {
  const objs: Base[] = [new Base(), new Boom(), new LateBoom()];
  for (const o of objs) {
    // If the body ran on this stack the throw would escape HERE and the
    // next line would never print.
    const p = o.run();
    console.log('call returned, no synchronous throw');
    try {
      console.log('resolved', await p);
    } catch (e) {
      console.log('rejected:', (e as Error).message);
    }
  }
  // ...and the same through `.catch` rather than try/await.
  const b: Base = new Boom();
  await b.run().catch((e: unknown) => {
    console.log('caught by .catch:', (e as Error).message);
    return -1;
  });
}
void main();
