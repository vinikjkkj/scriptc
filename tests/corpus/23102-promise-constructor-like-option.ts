// A record member typed `PromiseConstructorLike` (pg's `PoolConfig.Promise`): the
// caller picks the Promise implementation. The only value a static build can hold
// there is the global Promise, and every member of the slot (new, resolve, reject)
// is the global's.
interface PoolOpts {
  host?: string;
  max?: number;
  Promise?: PromiseConstructorLike | undefined;
}
interface FullOpts {
  host?: string;
  Promise?: PromiseConstructor | undefined;
}

class Pool {
  readonly Promise: PromiseConstructor;
  readonly host: string;
  constructor(opts: FullOpts) {
    this.Promise = opts.Promise ?? Promise;
    this.host = opts.host ?? "localhost";
  }
  connect(): PromiseLike<string> {
    return new this.Promise<string>((resolve) => resolve("connected:" + this.host));
  }
  failed(): PromiseLike<string> {
    return this.Promise.reject(new Error("refused:" + this.host));
  }
  ready(): PromiseLike<string> {
    return this.Promise.resolve("ready");
  }
}

function build(o: PoolOpts): PromiseLike<string> {
  const P = o.Promise ?? Promise;
  return new P<string>((res) => res((o.host ?? "none") + ":" + (o.max ?? 0)));
}

async function main(): Promise<void> {
  console.log(await build({ host: "h", max: 2 }));
  console.log(await build({ host: "g", Promise: Promise }));
  console.log(await build({}));
  const p = new Pool({ host: "db" });
  console.log(await p.connect());
  console.log(await p.ready());
  try {
    await p.failed();
  } catch (e) {
    console.log((e as Error).message);
  }
  const q = new Pool({ Promise: Promise });
  console.log(await q.connect(), q.Promise === Promise, typeof q.Promise);
}
main();
