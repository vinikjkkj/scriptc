// A record whose field is typed through an alias of `any` (the shape a types-hidden package gives `pool: Pool`): it holds a class instance, a plain object and a class value, and narrows on instanceof.
type Pool = any;
type PoolConfig = any;
class RealPool {
  n: number;
  constructor(n: number) { this.n = n; }
  end(): string { return "end" + this.n; }
}
interface Opts { readonly pool: Pool; readonly sessionId: string; readonly tablePrefix?: string }
interface Cfg { readonly pool: Pool | PoolConfig; readonly tablePrefix?: string; readonly max?: number }
function isPool(v: Pool | PoolConfig): boolean { return v instanceof RealPool; }
function build(cfg: Cfg): Opts {
  const pool = isPool(cfg.pool) ? cfg.pool : new RealPool(cfg.pool.max ?? 1);
  return { pool, sessionId: "s1", tablePrefix: cfg.tablePrefix ?? "" };
}
const a = build({ pool: new RealPool(7), tablePrefix: "t_" });
const b = build({ pool: { host: "h", max: 3 } });
console.log(a.pool.end(), b.pool.end(), a.tablePrefix, b.tablePrefix === "", a.pool instanceof RealPool, b.pool instanceof RealPool);
console.log(a.pool === build({ pool: a.pool }).pool);
console.log(a, b);
const { pool, sessionId } = a;
console.log(pool.n, sessionId);
const holder: { readonly klass: any } = { klass: RealPool };
const made = new holder.klass(9);
console.log(made.end(), made instanceof RealPool, holder.klass === RealPool, typeof holder.klass);
