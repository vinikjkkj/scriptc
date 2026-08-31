// @dynamic
// `new Request(src, { method })` INHERITS src's body. Node throws a
// TypeError when the resulting method is GET or HEAD; the island accepted
// it and produced a GET carrying a body. Upstream 7de8be18 (merge 9fb068ae).
//
// Only the VERDICT is compared, never the engine's message text (the island
// shim's rule) -- so each case answers a fixed token.
const probe = `
  (() => {
    const out = [];
    const say = (label, fn) => {
      try { out.push(label + "=" + fn()); }
      catch (e) { out.push(label + "=threw:" + (e && e.constructor ? e.constructor.name : "?")); }
    };
    const post = new Request("https://example.invalid/x", { method: "POST", body: "hello" });
    say("src", () => post.method + "/" + post.bodyUsed);
    // The defect: the body comes from the SOURCE request, not from init.
    say("inheritGET",  () => new Request(post, { method: "GET" }).method);
    say("inheritHEAD", () => new Request(post, { method: "head" }).method);
    // Controls that must NOT change.
    say("plainGET",    () => new Request(post, { method: "GET", body: null }).method);
    say("keepPOST",    () => { const r = new Request(post, { method: "POST" }); return r.method; });
    say("retarget",    () => new Request(post, { method: "PUT" }).method);
    say("noBodySrc",   () => new Request(new Request("https://example.invalid/y"), { method: "GET" }).method);
    say("explicitGET", () => new Request("https://example.invalid/z", { method: "GET", body: "b" }).method);
    say("cloneAll",    () => { const r = new Request(post); return r.method + "/" + r.url; });
    say("srcStillUsable", () => post.method);
    return out.join("|");
  })()
`;
console.log(__island_eval(probe));
