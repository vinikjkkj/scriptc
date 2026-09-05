// The store-mongo shape verbatim, and the reason this block exists: a
// CONCRETE async base method with an empty body, called virtually through
// `this` from inside another async base method, its promise cached in a
// field and `.catch`ed; plus an async `destroy` whose one override calls
// `super.destroy()`. Nine of these overrides stood between store-mongo and
// a binary.
abstract class BaseStore {
  name: string;
  indexPromise: Promise<void> | null = null;
  constructor(name: string) {
    this.name = name;
  }
  protected async ensureIndexes(): Promise<void> {
    if (this.indexPromise === null) {
      this.indexPromise = this.createIndexes().catch((err: unknown) => {
        console.log('index error on', this.name, (err as Error).message);
      });
    }
    await this.indexPromise;
  }
  protected async createIndexes(): Promise<void> {
    // deliberately empty, exactly like BaseMongoStore's
  }
  async destroy(): Promise<void> {
    console.log('base destroy', this.name);
  }
  async open(): Promise<string> {
    await this.ensureIndexes();
    return 'open:' + this.name;
  }
}
class Messages extends BaseStore {
  protected override async createIndexes(): Promise<void> {
    console.log('messages: creating indexes');
  }
}
class Contacts extends BaseStore {
  protected override async createIndexes(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1);
    });
    console.log('contacts: creating indexes (after a turn)');
  }
}
class Broken extends BaseStore {
  protected override async createIndexes(): Promise<void> {
    throw new Error('no such collection');
  }
  override async destroy(): Promise<void> {
    await super.destroy();
    console.log('broken destroy extra');
  }
}
// Inherits the base's own async body — its entry is the BASE's thunk.
class Plain extends BaseStore {}
async function main(): Promise<void> {
  const stores: BaseStore[] = [
    new Messages('m'),
    new Contacts('c'),
    new Broken('b'),
    new Plain('p'),
  ];
  for (const s of stores) console.log(await s.open());
  // Idempotence: the cached promise is awaited, the body does not re-run.
  for (const s of stores) console.log(await s.open());
  for (const s of stores) await s.destroy();
}
void main();
