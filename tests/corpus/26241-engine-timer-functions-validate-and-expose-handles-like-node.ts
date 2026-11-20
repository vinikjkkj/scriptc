// Timer functions inside new Function text: names and lengths, ERR_INVALID_ARG_TYPE for a non-function callback, the Timeout and
// Immediate handles (ref, unref, hasRef, close, numeric form), clearing, and the arguments passed through.
const run: any = new Function(`
  const log = console.log;
  for (const f of [setTimeout, setInterval, setImmediate, queueMicrotask]) {
    for (const bad of ["x", undefined, null, 5, {}, [], Symbol("s"), 1n, "a long string that is well over twenty five chars"]) {
      try { f(bad); } catch (e) { log(f.name, e.name, e.code, e.message); }
    }
  }
  log(setTimeout.name, setTimeout.length, setInterval.name, clearTimeout.name, clearTimeout.length, clearInterval.name, setImmediate.name, setImmediate.length, clearImmediate.name, queueMicrotask.length);
  const t = setTimeout(() => log("t fired"), 200);
  log(t.hasRef()); t.unref(); log(t.hasRef()); t.ref(); log(t.hasRef());
  log(typeof +t, typeof t.refresh, typeof t.close);
  const t2 = setTimeout(() => log("NEVER"), 5);
  log(t2.close() === t2);
  const t3 = setTimeout(() => log("NEVER"), 5);
  clearTimeout(+t3);
  const iv = setInterval(() => { log("iv"); clearInterval(iv); }, 100);
  setTimeout((...a) => log("args", a), 400, 1, 2, 3);
  const im = setImmediate((a) => log("immediate", a), 7);
  log(im.hasRef()); im.unref(); log(im.hasRef()); im.ref(); log(im.hasRef());
  const im2 = setImmediate(() => log("NEVER"));
  clearImmediate(im2);
  clearTimeout(undefined); clearTimeout(null); clearImmediate(undefined);
`);
run();
