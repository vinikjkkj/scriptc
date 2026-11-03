// A store-shaped program: a config record with a `Pool | PoolConfig` alias-any field, a type guard on a method probe, an options record handed to an abstract base's constructor, destructuring and a JS-callable receiving the record.
type Pool = any;
type PoolConfig = any;
type Logger = { info(m: string): void };
interface StoreConfig { readonly pool: Pool | PoolConfig; readonly tablePrefix?: string; readonly batch?: number }
interface StorageOptions { readonly pool: Pool; readonly sessionId: string; readonly tablePrefix?: string; readonly logger?: Logger }
class FakePool {
  calls: string[] = [];
  connect(): string { this.calls.push("connect"); return "conn"; }
  end(): string { return "ended " + this.calls.length; }
}
function createPool(cfg: PoolConfig): FakePool { const p = new FakePool(); p.calls.push("cfg:" + cfg.host); return p; }
function isPool(v: Pool | PoolConfig): boolean { return typeof (v as Pool).connect === "function"; }
abstract class BaseStore {
  protected readonly pool: Pool;
  protected readonly sessionId: string;
  protected readonly prefix: string;
  protected constructor(options: StorageOptions) {
    this.pool = options.pool;
    this.sessionId = options.sessionId;
    this.prefix = options.tablePrefix ?? "";
  }
  describe(): string { return this.prefix + this.sessionId + ":" + this.pool.end(); }
}
class AuthStore extends BaseStore { constructor(o: StorageOptions) { super(o); } }
function create(config: StoreConfig): { owns: boolean; store: AuthStore } {
  const pool = isPool(config.pool) ? config.pool : createPool(config.pool);
  const owns = !isPool(config.pool);
  const opts = (sessionId: string): StorageOptions => ({ pool, sessionId, tablePrefix: config.tablePrefix ?? "" });
  return { owns, store: new AuthStore(opts("default")) };
}
const shared = new FakePool();
const r1 = create({ pool: { host: "db", max: 2 }, tablePrefix: "t_" });
const r2 = create({ pool: shared });
console.log(r1.owns, r2.owns, r1.store.describe(), r2.store.describe());
const o: StorageOptions = { pool: shared, sessionId: "q" };
const { pool, sessionId, tablePrefix } = o;
console.log(pool === shared, sessionId, tablePrefix, o);
function viaJs(rec: StorageOptions, fn: (p: Pool) => string): string { return fn(rec.pool); }
console.log(viaJs(o, (p) => p.connect()), shared.calls);
const cfgs: StoreConfig[] = [{ pool: shared }, { pool: { host: "z" }, batch: 3 }, { pool: null }];
console.log(cfgs.map((c) => isPool(c.pool === null ? {} : c.pool)));
