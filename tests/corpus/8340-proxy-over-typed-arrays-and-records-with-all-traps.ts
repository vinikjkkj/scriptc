export {};
const arr: number[] = [1, 2, 3];
const seen: string[] = [];
const pa = new Proxy(arr, {
  get(t, k, r) { seen.push(String(k)); return Reflect.get(t, k, r); },
  set(t, k, v, r) { seen.push("set " + String(k)); return Reflect.set(t, k, v, r); },
});
pa.push(4);
console.log(pa.length, pa[0], arr.length, arr, seen.join(","));
interface Cfg { host: string; port: number }
const cfg: Cfg = { host: "h", port: 1 };
const guarded = new Proxy(cfg, {
  set(t, k, v) { if (k === "port" && typeof v !== "number") throw new TypeError("port"); (t as any)[k] = v; return true; },
  has(t, k) { return k !== "host" && k in t; },
  deleteProperty(t, k) { return false; },
  ownKeys(t) { return ["port"]; },
  getOwnPropertyDescriptor(t, k) { return { value: (t as any)[k], enumerable: true, configurable: true }; },
});
guarded.port = 2;
try { (guarded as any).port = "x"; } catch (e) { console.log((e as Error).message); }
let del: unknown; try { del = delete (guarded as any).port; } catch (e) { del = (e as Error).message; }
console.log(cfg, "host" in guarded, "port" in guarded, Object.keys(guarded), del);
