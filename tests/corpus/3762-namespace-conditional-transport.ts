// A module NAMESPACE chosen at runtime — zapo's transport shape:
//
//   const transport = parsed.protocol === 'https:' ? https : http
//   transport.request(url, { method, headers }, (res) => ...)
//
// There is no module object in a compiled binary, so the DECLARATION
// lowers to its condition and the binding's slot holds the selector; each
// member call lowers once per arm under a ternary on it. The two things
// that decides, and that this file pins:
//
//   1. WHEN the condition runs. It runs at the declaration, exactly once,
//      exactly where Node runs it — so a later write to a binding the
//      condition read must NOT move the choice.
//   2. That the arguments still evaluate exactly once. The arms duplicate
//      the whole call in the emitted code, but only one arm runs, so a
//      side-effecting argument must fire once and no more.
//
// Only the http arm dials here (a corpus program has no certificates);
// the https arm is emitted all the same, and the real TLS dial through
// one selector is tests/fixtures/server/cases/namespace-conditional-transport.
// The fences are tests/diagnostics/namespace-conditional.ts.
import * as http from "node:http";
import * as https from "node:https";

const server = http.createServer((req, res) => {
  res.end(`${req.method} ${req.url}`);
});

let calls = 0;
function once(tag: string): string {
  calls++;
  return tag;
}

server.listen(0, () => {
  const port = server.address().port;
  const show = (tag: string, res: http.IncomingMessage, next: () => void) => {
    let b = "";
    res.on("data", (c) => { b += c; });
    res.on("end", () => { console.log(tag, res.statusCode, b); next(); });
  };

  // 1. The zapo shape: the scheme picks the module.
  const url = `http://127.0.0.1:${port}/a?q=1`;
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const r1 = transport.request(url, { method: "POST", headers: { "x-a": once("1") } }, (res) => {
    show("scheme", res, () => {
      // The header value's helper ran exactly once even though the call is
      // emitted twice, once per arm.
      console.log("arg evaluations", calls);
      step2(port);
    });
  });
  r1.end();

  function step2(p: number): void {
    // 2. The condition runs at the DECLARATION: `mut` is false there, and
    // the write below cannot move the choice to the https arm.
    let mut = false;
    const t = mut ? https : http;
    mut = true;
    const r = t.request(`http://127.0.0.1:${p}/late`, { method: "GET" }, (res) => {
      show("declaration-time", res, () => step3(p));
    });
    r.end();
  }

  function step3(p: number): void {
    // 3. get() through the selector, and a second use of the SAME binding.
    const t = process.argv.length > 99 ? https : http;
    t.get(`http://127.0.0.1:${p}/g1`, { headers: { "x-b": "2" } }, (res) => {
      show("get", res, () => {
        t.get(`http://127.0.0.1:${p}/g2`, {}, (res2) => {
          show("second use", res2, () => step4(p));
        });
      });
    });
  }

  function step4(p: number): void {
    // 4. Two selectors in one scope, one captured by a closure, and an
    // optional-chained call (a module object is never nullish, so `?.`
    // must not short-circuit on either arm).
    const a = process.argv.length > 99 ? https : http;
    const b = process.argv.length > 99 ? http : https;
    const run = (): void => {
      const r = a?.request(`http://127.0.0.1:${p}/closure`, { method: "PUT" }, (res) => {
        show("captured + optional", res, () => {
          // The OTHER selector in the same scope carries the OTHER
          // choice: b is the https module here, and an http: URL through
          // it is Node's ERR_INVALID_PROTOCOL — the proof that two
          // selectors in one scope do not share a slot.
          try {
            b.request(`http://127.0.0.1:${p}/other`, { method: "GET" }, () => {});
          } catch (e) {
            console.log("second selector", (e as Error).message);
          }
          console.log("arg evaluations", calls);
          server.close();
        });
      });
      r.end();
    };
    run();
  }
});
