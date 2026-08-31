// @dynamic
// `new Request(src, init)` inherits src's BODY. Node throws a TypeError when
// the resulting method is GET or HEAD; the island accepted it and produced a
// GET carrying a body, and fetch's own glue builds through this same
// constructor (`new g.Request(base, reqInit)` in scr_fetch.c and
// scr_fetch_curl.c), so `fetch(postReq, { method: 'GET' })` was the same
// wrong answer. Upstream vercel-labs/scriptc 7de8be18 (merge 9fb068ae).
//
// ONE SOURCE REQUEST PER CASE, deliberately. Node also DISTURBS a source
// request's body when it is used to build another one, so a shared source
// would measure that rule instead of this one -- and that rule is a separate
// live divergence here (tests/perf/upstream/request-source-disturbed.ts).
//
// Only the VERDICT is compared, never the engine's message text: island
// error strings are not oracled against Node (island-shim.mjs's rule), so
// each case answers a fixed token and a throw answers its constructor name.
const probe = `
  (() => {
    const out = [];
    const src = () => new Request("https://example.invalid/x", { method: "POST", body: "hello" });
    const say = (label, fn) => {
      try { out.push(label + "=" + fn()); }
      catch (e) { out.push(label + "=threw:" + (e && e.constructor ? e.constructor.name : "?")); }
    };
    // THE DEFECT: the body comes from the SOURCE request, and the only body
    // check was on init.body -- the one thing that branch cannot see.
    say("inheritGET",   () => new Request(src(), { method: "GET" }).method);
    say("inheritHEAD",  () => new Request(src(), { method: "head" }).method);
    // Two traps. 'body: null' in init does NOT clear an inherited body, and
    // an EMPTY-string body is still a body -- so the test is '!== null' and
    // never truthiness.
    say("nullBodyGET",  () => new Request(src(), { method: "GET", body: null }).method);
    say("emptyStrBody", () => new Request(new Request("https://example.invalid/w", { method: "POST", body: "" }), { method: "GET" }).method);
    // CONTROLS that must not move: a retarget to another body-bearing
    // method, a bodyless source promoted to GET/HEAD, the explicit-body form
    // that already threw, a plain clone, and a GET source given a body.
    say("keepPOST",     () => new Request(src(), { method: "POST" }).method);
    say("retargetPUT",  () => new Request(src(), { method: "PUT" }).method);
    say("noBodySrcGET", () => new Request(new Request("https://example.invalid/y"), { method: "GET" }).method);
    say("noBodySrcHEAD",() => new Request(new Request("https://example.invalid/y"), { method: "HEAD" }).method);
    say("explicitGET",  () => new Request("https://example.invalid/z", { method: "GET", body: "b" }).method);
    say("explicitHEAD", () => new Request("https://example.invalid/z", { method: "HEAD", body: "b" }).method);
    say("plainClone",   () => { const r = new Request(src()); return r.method + "/" + r.url; });
    say("getSrcToPOST", () => new Request(new Request("https://example.invalid/y"), { method: "POST", body: "b" }).method);
    return out.join("|");
  })()
`;
console.log(__island_eval(probe));
