// `Promise<void>` through a slot — the return shape store-mongo's
// createIndexes and destroy both use — reached from inside another async
// body (a fiber calling a virtual fiber), and again from a loop that awaits
// each in turn so the suspensions serialize.
class Sink {
  async accept(v: string): Promise<void> {
    console.log('sink:', v);
  }
}
class Loud extends Sink {
  override async accept(v: string): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1);
    });
    console.log('LOUD:', v.toUpperCase());
  }
}
class Counting extends Sink {
  seen = 0;
  override async accept(v: string): Promise<void> {
    this.seen += 1;
    console.log('counted', this.seen, v);
  }
}
async function drain(sinks: Sink[], v: string): Promise<void> {
  for (const s of sinks) {
    await s.accept(v);
  }
  console.log('drained', v);
}
async function main(): Promise<void> {
  const sinks: Sink[] = [new Sink(), new Loud(), new Counting()];
  await drain(sinks, 'x');
  await drain(sinks, 'y');
  // Not awaited in order: start them all, then await — the Loud one lands
  // last because it is the only one that suspends.
  const ps = sinks.map((s) => s.accept('z'));
  console.log('all started');
  for (const p of ps) await p;
  console.log('all done');
}
void main();
