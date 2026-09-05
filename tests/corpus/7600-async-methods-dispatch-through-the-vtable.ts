// An `async` method reached through a BASE-TYPED reference must dispatch to
// the subclass's body — and must do it the way Node does: spawn a fiber and
// hand the caller a promise.
//
// An async method's module function is the FIBER BODY: it returns the
// promise's INNER value and, entered directly, runs on the caller's stack.
// So it is not what a vtable slot may hold. The slot is typed at the
// PROMISE and its entry is a synthesized thunk whose one call of the body
// goes through the emitted spawn wrapper — the same path a direct call
// takes. Everything below is the difference between that and a raw entry.
class Base {
  async label(): Promise<string> {
    return 'base';
  }
}
class Derived extends Base {
  override async label(): Promise<string> {
    return 'derived';
  }
}
class Slow extends Base {
  override async label(): Promise<string> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 5);
    });
    return 'slow';
  }
}

// AWAITED through the base type.
async function main(): Promise<void> {
  const objs: Base[] = [new Base(), new Derived(), new Slow()];
  for (const o of objs) console.log('awaited:', await o.label());

  // NOT awaited: the value handed back is a real promise. `.then` schedules
  // a callback that runs on a LATER turn (a raw string would not have one),
  // and awaiting the same value afterwards still delivers.
  const d: Base = new Derived();
  const p = d.label();
  void p.then((v: string) => {
    console.log('then fired:', v);
  });
  console.log('the caller keeps running past the call and past .then()');
  console.log('awaited later:', await p);

  // A body that suspends: the caller must get the promise back BEFORE the
  // body has finished, which is only true if a fiber really parked.
  const s: Base = new Slow();
  const q = s.label();
  console.log('pending call returned to the caller');
  console.log('pending awaited:', await q);
}
void main();
