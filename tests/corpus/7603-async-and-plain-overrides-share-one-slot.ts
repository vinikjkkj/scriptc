// `async m(): Promise<T>` and a plain `m(): Promise<T>` have the SAME slot
// ABI, so either may override the other. Only the async side needs the
// synthesized entry, and the choice is per class — a hierarchy mixing both
// must dispatch every member correctly.
class SyncBase {
  // Not `async`: it builds the promise itself, so its own function IS the
  // vtable entry.
  ready(): Promise<string> {
    return Promise.resolve('sync-base');
  }
}
class AsyncOver extends SyncBase {
  override async ready(): Promise<string> {
    return 'async-override';
  }
}
class AsyncBase {
  async ready(): Promise<string> {
    return 'async-base';
  }
}
class SyncOver extends AsyncBase {
  override ready(): Promise<string> {
    return Promise.resolve('sync-override');
  }
}
async function main(): Promise<void> {
  const a: SyncBase[] = [new SyncBase(), new AsyncOver()];
  for (const o of a) console.log('A:', await o.ready());
  const b: AsyncBase[] = [new AsyncBase(), new SyncOver()];
  for (const o of b) console.log('B:', await o.ready());
  // Not awaited: both sides must be thenables that fire on a later turn.
  const p1 = (new AsyncOver() as SyncBase).ready();
  const p2 = (new SyncOver() as AsyncBase).ready();
  void p1.then((v: string) => {
    console.log('p1 then:', v);
  });
  void p2.then((v: string) => {
    console.log('p2 then:', v);
  });
  console.log('both started');
  console.log(await p1, await p2);
}
void main();
