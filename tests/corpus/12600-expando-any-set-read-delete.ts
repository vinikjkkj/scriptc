// An expando written through an untyped (any) view of a class instance is an
// ordinary own property in JS: it is readable, `in`-visible, deletable, and a
// later write takes the same slot. Each of these threw "a property write on a
// dynamic Config is not supported yet" before the instance carried a run-time
// property table.
class Config {
  host: string;
  port: number;
  constructor(o: { host: string }) { this.host = o.host; this.port = 3306; }
}
class Pool {
  config: Config;
  n: number = 0;
  constructor(config: Config) { this.config = config; }
}
const cfg = new Config({ host: "h" });
const pool = new Pool(cfg);
const anyCfg: any = cfg;
anyCfg.pool = "P";
console.log("read", anyCfg.pool, (cfg as any).pool);
(pool.config as any).connectionConfig = pool;
console.log("typeof", typeof (pool.config as any).connectionConfig);
console.log("in", "pool" in anyCfg, "missing" in anyCfg);
anyCfg.pool = "again";
console.log("rewrite", anyCfg.pool, cfg.host, cfg.port);
console.log("del", delete anyCfg.pool, "pool" in anyCfg, anyCfg.pool);
console.log("readd", anyCfg.pool = 9, anyCfg.pool);
