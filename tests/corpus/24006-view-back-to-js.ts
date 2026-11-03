// A view handed to code that takes an untyped value is the very object: its writes are seen through the
// view, and the view of what it returns is again a view of the same object.
interface Cfg { host: string; port: number }
function touch(x: unknown): unknown {
  const o = x as { host: string; port: number; seen?: boolean };
  o.seen = true;
  o.port = o.port + 1;
  return x;
}
const raw = JSON.parse('{"host":"h","port":80,"keep":"k"}') as unknown;
const cfg = raw as Cfg;
const out = touch(cfg) as Cfg;
console.log(cfg.port, out.port, out === cfg, JSON.stringify(raw), cfg);
const built: Cfg = { host: "b", port: 1 };
const out2 = touch(built) as Cfg;
console.log(built.port, out2.port, out2 === built, JSON.stringify(built));
