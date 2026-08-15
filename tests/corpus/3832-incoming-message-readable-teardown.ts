// The teardown half of an IncomingMessage in a Readable slot.
//
// A Readable that closes SILENTLY when its source dies is worse than one
// that never worked: `for await` finishes, the caller gets a short body
// and no error, and a truncated download reads as a successful one. Node
// does not do that, and neither does the view. Measured against Node
// v25.9.0 (repro-inc/m5.mjs) before the adapter existed:
//
//   * a body cut short by the peer emits `Error: aborted` with
//     `code: 'ECONNRESET'` and THEN 'close' (case A). The runtime's own
//     premature pass fires no 'error' on the REQUEST -- a separate,
//     pre-existing divergence -- so the view mints this one itself off
//     the fact that its own readable side never ended;
//   * `destroy()` on the slot value IS `res.destroy()`: it tears the
//     connection down, and a destroy carrying no error emits no 'error'
//     (case B) while one carrying an error emits exactly that error
//     (case C). The second is the case that caught a real bug: the
//     adapter's `_destroy` was completing with NULL, which is Node's
//     "the callback swallowed it" path, so case C emitted nothing;
//   * a conversion of a response whose body ALREADY finished answers an
//     ended Readable rather than one that waits forever (case D);
//   * `destroy()` before a byte is read still closes cleanly (case E).
//
// Every request carries its own 'error' listener: destroying a response
// mid-exchange makes the CLIENT REQUEST emit too, and an unhandled
// 'error' is fatal in Node and here alike.
import * as http from "node:http";
import { Readable } from "node:stream";

const server = http.createServer((req, res) => {
  if (req.url === "/cut") {
    // A content-length the body never satisfies, then the socket dies.
    res.writeHead(200, { "content-length": "100" });
    res.write("half");
    setTimeout(() => { req.socket.destroy(); }, 20);
  } else if (req.url === "/slow") {
    res.writeHead(200);
    res.write("one");
    setTimeout(() => { res.write("two"); }, 20);
    setTimeout(() => { res.end("three"); }, 400);
  } else {
    res.writeHead(200);
    res.end("short");
  }
});

function slot(res: http.IncomingMessage): Readable { return res; }

function base(): string {
  return "http://127.0.0.1:" + String((server.address() as { port: number }).port);
}

server.listen(0, () => {
  // A. the peer cuts the body: 'error' aborted/ECONNRESET, then 'close'
  const reqA = http.request(base() + "/cut", { agent: false }, (res) => {
    const b = slot(res);
    const seen: string[] = [];
    b.on("data", (c: Uint8Array) => { seen.push(Buffer.from(c).toString()); });
    b.on("error", (e: Error) => {
      console.log("A error name=" + e.name +
        " message=" + e.message +
        " code=" + String((e as NodeJS.ErrnoException).code));
    });
    b.on("close", () => {
      console.log("A close seen=" + seen.join("|") +
        " destroyed=" + String(b.destroyed) +
        " ended=" + String(b.readableEnded));

      // B. destroy() with NO error: no 'error' on the body, just 'close'
      const reqB = http.request(base() + "/slow", { agent: false }, (res2) => {
        const b2 = slot(res2);
        let errsB = 0;
        b2.on("error", () => { errsB++; });
        b2.on("data", () => { b2.destroy(); });
        b2.on("close", () => {
          console.log("B close destroyed=" + String(b2.destroyed) +
            " bodyErrors=" + String(errsB));

          // C. destroy(err): that exact error reaches the listener
          const reqC = http.request(base() + "/slow", { agent: false }, (res3) => {
            const b3 = slot(res3);
            b3.on("error", (e: Error) => {
              console.log("C body error name=" + e.name + " message=" + e.message);
            });
            b3.on("data", () => { b3.destroy(new Error("over budget")); });
            b3.on("close", () => {
              console.log("C close destroyed=" + String(b3.destroyed));

              // D. convert a response whose body already finished
              const reqD = http.request(base() + "/short", { agent: false }, (res4) => {
                res4.on("data", () => { /* drain it first */ });
                res4.on("end", () => {
                  // A stream that has already ended never fires 'end'
                  // again -- in Node or here -- so the check is the FLAGS.
                  // One turn later, DELIBERATELY: Node hands back the very
                  // object that already ended, while a view built after
                  // the fact is a fresh Readable that ends on its own tick
                  // queue, so the two agree a turn later and not before.
                  // That is the one place this conversion is not Node's
                  // single object and it is measured here rather than
                  // hidden.
                  const b4 = slot(res4);
                  setTimeout(() => {
                    console.log("D late-conversion ended=" + String(b4.readableEnded) +
                      " readable=" + String(b4.readable) +
                      " length=" + String(b4.readableLength));
                    // E. destroy before a byte is read
                    const reqE = http.request(base() + "/slow", { agent: false }, (res5) => {
                      const b5 = slot(res5);
                      let errsE = 0;
                      b5.on("error", () => { errsE++; });
                      b5.on("close", () => {
                        console.log("E close destroyed=" + String(b5.destroyed) +
                          " bodyErrors=" + String(errsE));
                        server.close();
                        console.log("done");
                      });
                      b5.destroy();
                    });
                    reqE.on("error", () => { /* the destroyed exchange */ });
                    reqE.end();
                  }, 0);
                });
              });
              reqD.on("error", () => { /* none expected */ });
              reqD.end();
            });
          });
          reqC.on("error", () => { /* the destroyed exchange */ });
          reqC.end();
        });
      });
      reqB.on("error", () => { /* the destroyed exchange */ });
      reqB.end();
    });
  });
  reqA.on("error", () => { /* the cut exchange */ });
  reqA.end();
});
