// The web globals Node exposes, used inside new Function text: encoders, structuredClone, atob/btoa, AbortController, EventTarget,
// performance, crypto, and `global`.
const run: any = new Function(`
  const log = console.log;
  const te = new TextEncoder().encode("h\\u00e9llo \\u20ac \\ud83d\\ude00");
  log(te, new TextEncoder().encoding, new TextDecoder().encoding);
  log(new TextDecoder().decode(te));
  log(new TextDecoder().decode(new Uint8Array([0xff, 0x41, 0xc3])));
  try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])); } catch (e) { log(e.name, e.code); }
  log(new TextEncoder().encodeInto("abc", new Uint8Array(2)));
  const src = { a: 1, d: new Date(0), m: new Map([[1, { x: 2 }]]), s: new Set([1]), r: /x/gi, u: new Uint8Array([1, 2]), n: [1, [2]], b: 5n };
  const cl = structuredClone(src);
  log(cl, cl !== src, cl.m !== src.m, cl.d instanceof Date);
  const cyc = { name: "c" }; cyc.self = cyc;
  const cc = structuredClone(cyc); log(cc.self === cc, cc !== cyc);
  for (const bad of [() => 1, Symbol("q")]) { try { structuredClone(bad); } catch (e) { log(e.name, e.code, e.message); } }
  log(btoa("hi \\u00ff"), atob("aGkg/w=="));
  try { atob("***"); } catch (e) { log(e.name, e.message); }
  const ac = new AbortController();
  ac.signal.addEventListener("abort", () => log("aborted", ac.signal.aborted, ac.signal.reason.name));
  log(ac.signal.aborted); ac.abort(); log(ac.signal.aborted);
  try { ac.signal.throwIfAborted(); } catch (e) { log(e.name, e.message); }
  const et = new EventTarget();
  et.addEventListener("x", (e) => log("x", e.type, e instanceof Event, e.target === et), { once: true });
  log(et.dispatchEvent(new Event("x")), et.dispatchEvent(new Event("x")));
  log(typeof performance.now(), performance.now() >= 0, typeof performance.timeOrigin);
  log(crypto.randomUUID().length, crypto.getRandomValues(new Uint8Array(4)).length);
  log(global === globalThis, typeof globalThis.setTimeout);
`);
run();
