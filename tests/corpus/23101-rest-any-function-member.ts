// A record member typed `(...messages: any[]) => void` (pg's `PoolConfig.log`):
// the member maps, closures of every arity flow into it, and calls through it
// reach the closure with JavaScript's argument semantics. `any[]` and
// `unknown[]` rest packs are one runtime pack.
interface PoolLike {
  host?: string;
  log?: ((...messages: any[]) => void) | undefined;
}
type Logger = (...messages: any[]) => void;

const lines: string[] = [];
function sink(...messages: any[]): void {
  lines.push(messages.length + ":" + messages.map((m) => typeof m + "=" + String(m)).join(","));
}
function fixed(a: string, b: number): void {
  lines.push("fixed " + a + " " + b);
}
function none(): void {
  lines.push("none");
}
class Holder {
  readonly log: Logger;
  constructor(cfg: PoolLike) {
    this.log = cfg.log ?? (() => {});
  }
  say(...args: any[]): void {
    this.log(...args);
  }
}
const h1 = new Holder({ log: sink });
h1.say();
h1.say("a");
h1.say("a", 1, true, null, undefined);
const arr = ["x", "y"];
h1.say(...arr);
const h2 = new Holder({ log: fixed });
h2.say("p", 7);
h2.say("q", 8, "extra");
const h3 = new Holder({ log: none });
h3.say(1, 2);
const h4 = new Holder({});
h4.say("dropped");
const cfg: PoolLike = { host: "h", log: (...m: any[]) => void lines.push("arrow " + m.length) };
if (cfg.log) cfg.log("z", "w");
const l2: Logger | undefined = cfg.log;
l2?.("opt");
l2?.("opt", 2, 3);
for (const l of lines) console.log(l);
console.log(typeof h1.log, typeof h4.log, cfg.host);
