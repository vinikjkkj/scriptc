// @dynamic
// Same question, one SOURCE REQUEST PER CASE. Node disturbs a source
// request's body when it is used to build another one, so reusing `post`
// across cases measures that rule instead of this one.
const probe = `
  (() => {
    const out = [];
    const src = () => new Request("https://example.invalid/x", { method: "POST", body: "hello" });
    const say = (label, fn) => {
      try { out.push(label + "=" + fn()); }
      catch (e) { out.push(label + "=threw:" + (e && e.constructor ? e.constructor.name : "?")); }
    };
    say("inheritGET",   () => new Request(src(), { method: "GET" }).method);
    say("inheritHEAD",  () => new Request(src(), { method: "head" }).method);
    say("nullBodyGET",  () => new Request(src(), { method: "GET", body: null }).method);
    say("keepPOST",     () => new Request(src(), { method: "POST" }).method);
    say("retargetPUT",  () => new Request(src(), { method: "PUT" }).method);
    say("noBodySrcGET", () => new Request(new Request("https://example.invalid/y"), { method: "GET" }).method);
    say("noBodySrcHEAD",() => new Request(new Request("https://example.invalid/y"), { method: "HEAD" }).method);
    say("explicitGET",  () => new Request("https://example.invalid/z", { method: "GET", body: "b" }).method);
    say("explicitHEAD", () => new Request("https://example.invalid/z", { method: "HEAD", body: "b" }).method);
    say("plainClone",   () => { const r = new Request(src()); return r.method + "/" + r.url; });
    say("getSrcToPOST", () => new Request(new Request("https://example.invalid/y"), { method: "POST", body: "b" }).method);
    say("emptyStrBody", () => new Request(new Request("https://example.invalid/w", { method: "POST", body: "" }), { method: "GET" }).method);
    return out.join("|");
  })()
`;
console.log(__island_eval(probe));
