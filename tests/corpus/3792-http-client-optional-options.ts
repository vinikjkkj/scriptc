// The other two thirds of zapo's httpRequest options record: an OPTIONAL
// headers record, and an Agent value alongside a URL first argument.
//
// Measured against Node v25.9.0 rather than assumed:
//
//   * `headers: undefined` is no headers AT ALL — not an empty object, not
//     a default set: Node's ClientRequest only walks the record when one
//     was given, so the request head carries exactly what a headers-free
//     call carries. The server echo below is what proves it, because the
//     difference between "absent" and "present but empty" is invisible
//     from the client side;
//   * an absent optional value must not evaluate its source twice — the
//     counter here is the check, since the obvious lowering (a ternary
//     over the union) reads the expression once per arm;
//   * an Agent value with a URL first argument dials the URL's own
//     host/port/path, and `agent.getName`-keyed accounting still applies:
//     maxSockets 1 serialises two overlapping requests, which is the
//     observable that separates a threaded agent from an ignored one.
//
// The last case is zapo's WaMediaTransferClient.httpRequest spelled
// exactly: method / headers / signal / agent in one record over a URL,
// every one of them optional. That call is the reason all three halves
// exist, and it compiles only when all three are lowered.
import * as http from "node:http";

interface Init {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

let evaluations = 0;

const server = http.createServer((req, res) => {
  const seen: string[] = [];
  for (const name of ["x-a", "x-b", "user-agent", "accept"]) {
    const v = req.headers[name];
    if (typeof v === "string") seen.push(name + "=" + v);
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(String(req.method) + " " + String(req.url) + " [" + seen.join(",") + "]");
});

function readAll(res: http.IncomingMessage, tag: string, done: () => void): void {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => { body += String(chunk); });
  res.on("end", () => {
    console.log(tag + " " + String(res.statusCode) + " " + body);
    done();
  });
}

server.listen(0, () => {
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + String(port);

  // A. the optional headers record, ABSENT
  const initA: Init = {};
  const reqA = http.request(base + "/a", { headers: initA.headers }, (res) => {
    readAll(res, "A", () => {
      // B. the same slot, PRESENT
      const initB: Init = { headers: { "x-a": "1", "x-b": "2" } };
      const reqB = http.request(base + "/b", { headers: initB.headers }, (res2) => {
        readAll(res2, "B", () => {
          // C. the source of an optional headers value is evaluated ONCE
          const initC: Init = { headers: { "x-a": "c" } };
          const headersOf = (i: Init): Readonly<Record<string, string>> | undefined => {
            evaluations++;
            return i.headers;
          };
          const reqC = http.request(base + "/c", { headers: headersOf(initC) }, (res3) => {
            readAll(res3, "C", () => {
              console.log("C header evaluations " + String(evaluations));

              // D. an Agent VALUE with a URL first argument
              const agent = new http.Agent({ maxSockets: 1 });
              const reqD = http.request(base + "/d?q=1", { agent, method: "HEAD" }, (res4) => {
                res4.on("data", () => {});
                res4.on("end", () => {
                  console.log("D " + String(res4.statusCode) + " method-echoed-in-headers");

                  // E. maxSockets 1 SERIALISES: the second dial waits for
                  //    the first to finish, so the completion order is the
                  //    submission order no matter what the server does
                  const order: string[] = [];
                  const finish = (tag: string): void => {
                    order.push(tag);
                    if (order.length === 2) {
                      console.log("E order " + order.join(","));

                      // F. zapo's spelling: every option optional, over a URL
                      const initF: Init = { method: "GET", headers: { "x-a": "z" } };
                      const agentF: http.Agent | undefined = undefined;
                      const reqF = http.request(base + "/f", {
                        method: initF.method ?? "GET",
                        headers: initF.headers,
                        signal: initF.signal ?? undefined,
                        agent: agentF ?? undefined,
                      }, (res6) => {
                        readAll(res6, "F", () => {
                          agent.destroy();
                          server.close();
                        });
                      });
                      reqF.on("error", (e) => { console.log("F error " + e.message); });
                      reqF.end();
                    }
                  };
                  const one = http.request(base + "/e1", { agent }, (r1) => {
                    r1.on("data", () => {});
                    r1.on("end", () => { finish("e1"); });
                  });
                  const two = http.request(base + "/e2", { agent }, (r2) => {
                    r2.on("data", () => {});
                    r2.on("end", () => { finish("e2"); });
                  });
                  one.on("error", (e) => { console.log("e1 error " + e.message); });
                  two.on("error", (e) => { console.log("e2 error " + e.message); });
                  one.end();
                  two.end();
                });
              });
              reqD.on("error", (e) => { console.log("D error " + e.message); });
              reqD.end();
            });
          });
          reqC.on("error", (e) => { console.log("C error " + e.message); });
          reqC.end();
        });
      });
      reqB.on("error", (e) => { console.log("B error " + e.message); });
      reqB.end();
    });
  });
  reqA.on("error", (e) => { console.log("A error " + e.message); });
  reqA.end();
});
