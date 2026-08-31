// @dynamic
// NOT corpus coverage: this FAILS today. Found while closing 7de8be18
// (the inherited-body TypeError, now tests/corpus/7351), and it is the
// SECOND rule that same construction carries -- nobody upstream filed it.
//
// Node DISTURBS the source request's body when a Request is built from a
// Request that has one: the construction succeeds, and every LATER use of
// the source throws `TypeError: Request body is unusable`. The island
// shares the bytes instead (`this._body = input._body; // shared bytes;
// fetch copies` in scr_web.c) and never marks the source used, so a second
// construction succeeds where Node throws.
//
// The two wrong cells are `retarget` and `cloneAll`, both AFTER `keepPOST`
// has consumed `post`:
//
//   node:   ...|keepPOST=POST|retarget=threw:TypeError|...|cloneAll=threw:TypeError|...
//   island: ...|keepPOST=POST|retarget=PUT|...|cloneAll=POST/https://example.invalid/x|...
//
// Deliberately not fixed with the inherited-body check. Marking a source
// disturbed is a real state change on a value the island's fetch glue
// re-reads (`if (r._body instanceof Uint8Array) body = r._body`), so it
// wants its own measurement and its own controls, not a rider on a
// five-line constructor fix. Promote it into the corpus the day it passes.
const probe = `
  (() => {
    const out = [];
    const say = (label, fn) => {
      try { out.push(label + "=" + fn()); }
      catch (e) { out.push(label + "=threw:" + (e && e.constructor ? e.constructor.name : "?")); }
    };
    const post = new Request("https://example.invalid/x", { method: "POST", body: "hello" });
    say("src", () => post.method + "/" + post.bodyUsed);
    say("inheritGET",  () => new Request(post, { method: "GET" }).method);
    say("inheritHEAD", () => new Request(post, { method: "head" }).method);
    say("plainGET",    () => new Request(post, { method: "GET", body: null }).method);
    // This one SUCCEEDS in both, and in Node it disturbs \`post\`.
    say("keepPOST",    () => new Request(post, { method: "POST" }).method);
    // ...so these two throw in Node and answer here.
    say("retarget",    () => new Request(post, { method: "PUT" }).method);
    say("cloneAll",    () => { const r = new Request(post); return r.method + "/" + r.url; });
    // A method read never needs the body, and stays fine in both.
    say("srcStillUsable", () => post.method);
    return out.join("|");
  })()
`;
console.log(__island_eval(probe));
