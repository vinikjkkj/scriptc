// An `http.IncomingMessage` IN a `Readable` slot.
//
// Node models `class IncomingMessage extends stream.Readable`: ONE
// object, two surfaces. This runtime has two representations (an
// ScrHttpReq is not an ScrStream), so the slot costs an ADAPTER rather
// than the pointer reinterpret a Duplex-into-Writable costs. Everything
// below was measured against Node v25.9.0 first, and the cases are the
// ones where an adapter can plausibly disagree with one object:
//
//   * IDENTITY. `f(res)` twice must answer the SAME stream, or a
//     response with two readers grows two independent bodies. The view
//     is memoized on the request; case A is the check.
//   * `readableHighWaterMark` is 16384 on an IncomingMessage, not the
//     65536 a bare `new Readable()` gets. Case A prints it, because a
//     view built with the wrong default paces a large body differently.
//   * BACKPRESSURE. Case F pulls 160 KB through the seam; the adapter
//     pauses the request when push() answers false and resumes it from
//     _read, so a wrong answer here is a lost or duplicated chunk, not
//     a slow one.
//   * An EMPTY body (a 204) must still END. Case C.
//   * The SERVER side is the same handle kind: case H puts a request
//     body in a Readable slot inside the handler.
//   * The slot may be a UNION arm (`Readable | null` — the shape every
//     "the body may be absent" response record has), a plain parameter,
//     or a FIELD of a record that width-copies into another. Cases A/B
//     take the union arm, G takes the parameter, and case D takes the
//     field, because the top-level coercion and the width-lift planner
//     are two copies of the same rule and have drifted apart before.
import * as http from "node:http";
import { Readable, Writable, pipeline } from "node:stream";

interface Resp {
  readonly status: number;
  readonly body: Readable | null;
}

// A record whose `body` field is copied OUT of another record: the
// width-lift path, not the top-level one.
interface Narrow {
  readonly body: Readable | null;
}

const server = http.createServer((req, res) => {
  if (req.url === "/chunks") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("aa");
    setTimeout(() => {
      res.write("bb");
      setTimeout(() => { res.end("cc"); }, 10);
    }, 10);
  } else if (req.url === "/big") {
    res.writeHead(200);
    let n = 0;
    const tick = (): void => {
      if (n >= 40) { res.end(); return; }
      n++;
      res.write("x".repeat(4096));
      setTimeout(tick, 1);
    };
    tick();
  } else if (req.url === "/empty") {
    res.writeHead(204);
    res.end();
  } else if (req.url === "/echo") {
    // The SERVER side: the request body in a Readable slot.
    const incoming: Readable = req;
    let got = 0;
    incoming.on("data", (c: Uint8Array) => { got += c.byteLength; });
    incoming.on("end", () => {
      res.writeHead(200);
      res.end("read " + String(got));
    });
  } else {
    res.writeHead(200);
    res.end("plain");
  }
});

function get(path: string, cb: (r: Resp) => void): void {
  const port = (server.address() as { port: number }).port;
  http.request("http://127.0.0.1:" + String(port) + path, { method: "GET", agent: false }, (res) => {
    cb({ status: res.statusCode ?? 0, body: res });
  }).end();
}

// The PARAMETER position: an IncomingMessage handed straight to a
// function whose parameter is a Readable (zapo's readAllBytes shape).
async function drain(s: Readable): Promise<number> {
  let total = 0;
  for await (const c of s) total += (c as Uint8Array).byteLength;
  return total;
}

server.listen(0, () => {
  // A. the union arm, twice on ONE response, then for-await
  http.request("http://127.0.0.1:" + String((server.address() as { port: number }).port) + "/chunks",
    { method: "GET", agent: false }, (res) => {
      const one: Resp = { status: res.statusCode ?? 0, body: res };
      const two: Resp = { status: res.statusCode ?? 0, body: res };
      console.log("A same=" + String(one.body === two.body));
      const b = one.body;
      if (b === null) { console.log("A no body"); return; }
      console.log("A instanceofReadable=" + String(b instanceof Readable));
      console.log("A hwm=" + String(b.readableHighWaterMark) +
        " objectMode=" + String(b.readableObjectMode));
      console.log("A beforeRead ended=" + String(b.readableEnded) +
        " destroyed=" + String(b.destroyed) + " readable=" + String(b.readable));
      drain(b).then((n) => {
        console.log("A bytes=" + String(n) + " ended=" + String(b.readableEnded));

        // B. 'data'/'end' on the slot value — chunk boundaries preserved
        get("/chunks", (r2) => {
          const b2 = r2.body;
          if (b2 === null) { console.log("B no body"); return; }
          const parts: string[] = [];
          b2.on("data", (c: Uint8Array) => { parts.push(Buffer.from(c).toString()); });
          b2.on("end", () => {
            console.log("B parts=" + parts.join("|") + " ended=" + String(b2.readableEnded));

            // C. a 204: an empty body still ends
            get("/empty", (r3) => {
              const b3 = r3.body;
              if (b3 === null) { console.log("C no body"); return; }
              drain(b3).then((n3) => {
                console.log("C status=" + String(r3.status) + " bytes=" + String(n3));

                // D. the WIDTH-LIFT position: a record field copied into
                //    another record's `Readable | null` field
                get("/chunks", (r4) => {
                  const narrow: Narrow = { body: r4.body };
                  const b4 = narrow.body;
                  if (b4 === null) { console.log("D no body"); return; }
                  console.log("D sameAsSource=" + String(b4 === r4.body));
                  drain(b4).then((n4) => {
                    console.log("D bytes=" + String(n4));

                    // E. pipe into a Writable, chunk for chunk
                    get("/chunks", (r5) => {
                      const b5 = r5.body;
                      if (b5 === null) { console.log("E no body"); return; }
                      const seen: string[] = [];
                      const w = new Writable({
                        write(chunk: Buffer, _enc: string, cbw: (e?: Error | null) => void) {
                          seen.push(chunk.toString());
                          cbw();
                        },
                      });
                      w.on("close", () => {
                        console.log("E piped=" + seen.join("|"));

                        // F. 160 KB through the seam — backpressure
                        get("/big", (r6) => {
                          const b6 = r6.body;
                          if (b6 === null) { console.log("F no body"); return; }
                          drain(b6).then((n6) => {
                            console.log("F bytes=" + String(n6));

                            // G. pipeline over the slot value
                            get("/chunks", (r7) => {
                              const b7 = r7.body;
                              if (b7 === null) { console.log("G no body"); return; }
                              const out: string[] = [];
                              const w7 = new Writable({
                                write(chunk: Buffer, _e: string, cbw: (e?: Error | null) => void) {
                                  out.push(chunk.toString());
                                  cbw();
                                },
                              });
                              pipeline(b7, w7, (err: Error | null) => {
                                console.log("G err=" + (err ? err.message : "none") +
                                  " out=" + out.join("|"));

                                // H. the SERVER side: a request body in a
                                //    Readable slot inside the handler
                                const port = (server.address() as { port: number }).port;
                                const reqH = http.request(
                                  "http://127.0.0.1:" + String(port) + "/echo",
                                  { method: "POST", agent: false },
                                  (resH) => {
                                    const bh = resH;
                                    const acc: string[] = [];
                                    bh.on("data", (c: Uint8Array) => { acc.push(Buffer.from(c).toString()); });
                                    bh.on("end", () => {
                                      console.log("H " + acc.join(""));
                                      server.close();
                                      console.log("done");
                                    });
                                  },
                                );
                                reqH.end("0123456789");
                              });
                            });
                          });
                        });
                      });
                      b5.pipe(w);
                    });
                  });
                });
              });
            });
          });
        });
      });
    }).end();
});
