// http.request's `signal` option — an AbortSignal tearing down an
// in-flight client request.
//
// Every property pinned here was MEASURED against Node v25.9.0 first (a
// local server, an abort at each point in the exchange), because most of
// them are not what the docs say and three of them are what a plausible
// implementation gets wrong:
//
//   * the error is an AbortError carrying `code: "ABORT_ERR"` — an
//     implementation that rebuilt it from `.message` would answer
//     `undefined` here, which is exactly why destroy(err) stayed fenced
//     for several blocks;
//   * the REASON is not the error: a custom reason carrying its own
//     `code` still produces the plain ABORT_ERR AbortError (Node hangs
//     the reason off `cause`, which no ScrError slot holds — and the
//     frontend refuses to READ `cause` on a plain Error, so the omission
//     is loud rather than silent);
//   * abort() RETURNS before its 'error' runs — a synchronous emission
//     would reorder the program;
//   * an already-aborted signal destroys the request during construction,
//     so `destroyed` is true on the very next line, and the error still
//     arrives afterwards;
//   * an abort AFTER the response completed is a no-op, and the signal
//     still fires its own listeners — the request removed only its own;
//   * a destroy() that came first WINS: the later abort changes nothing,
//     and the error stays 'socket hang up' / ECONNRESET;
//   * the request's internal listener is registered AT CONSTRUCTION, so a
//     user listener added BEFORE it sees `req.destroyed === false` and one
//     added AFTER sees true. That ordering is why the runtime keeps its
//     native listener in the signal's own vector, on the same sequence
//     counter, rather than firing it always-first or always-last.
//
// `agent: false` throughout: Node's default agent keeps destroyed sockets
// pooled and adds one extra 'error' emission per destroyed predecessor
// (3471's documented bound), which is a property of the agent and not of
// abort.
import * as http from "node:http";

class Coded extends Error {
  code: string;
  constructor(msg: string) {
    super(msg);
    this.name = "Coded";
    this.code = "ERR_MINE";
  }
}

interface Init {
  readonly signal?: AbortSignal;
}

const server = http.createServer((req, res) => {
  if (req.url === "/slow") {
    setTimeout(() => { res.writeHead(200); res.end("late"); }, 400);
  } else {
    res.writeHead(200);
    res.end("ok");
  }
});

function describe(tag: string, e: Error): void {
  console.log(
    tag + " error name=" + e.name +
    " code=" + (e as NodeJS.ErrnoException).code +
    " message=" + e.message +
    " isError=" + (e instanceof Error),
  );
}

server.listen(0, () => {
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + String(port);

  // A. mid-flight, the default reason
  const ca = new AbortController();
  const reqA = http.request(base + "/slow", { signal: ca.signal, agent: false }, () => {
    console.log("A response (unexpected)");
  });
  reqA.on("error", (e) => { describe("A", e); });
  reqA.on("close", () => {
    console.log("A close destroyed=" + reqA.destroyed);

    // B. an ALREADY-aborted signal: destroyed during construction
    const cb = new AbortController();
    cb.abort();
    const reqB = http.request(base + "/slow", { signal: cb.signal, agent: false }, () => {
      console.log("B response (unexpected)");
    });
    console.log("B destroyed right after the call=" + reqB.destroyed);
    reqB.on("error", (e) => { describe("B", e); });
    reqB.on("close", () => {
      console.log("B close");

      // C. abort AFTER the response completed — a no-op, but the signal
      //    still fires the listeners the USER put on it
      const cc = new AbortController();
      cc.signal.addEventListener("abort", () => { console.log("C user listener"); });
      const reqC = http.request(base + "/fast", { signal: cc.signal, agent: false }, (res) => {
        res.on("data", () => {});
        res.on("end", () => { console.log("C response end status=" + String(res.statusCode)); });
      });
      reqC.on("error", (e) => { describe("C", e); });
      reqC.on("close", () => {
        console.log("C close");
        cc.abort();
        console.log("C abort after completion returned, aborted=" + cc.signal.aborted);

        // D. the OPTIONAL slot, absent: `signal: init.signal ?? undefined`
        const initD: Init = {};
        const reqD = http.request(base + "/fast", {
          method: "GET",
          signal: initD.signal ?? undefined,
          agent: false,
        }, (res) => {
          res.on("data", () => {});
          res.on("end", () => { console.log("D response end status=" + String(res.statusCode)); });
        });
        reqD.on("error", (e) => { describe("D", e); });
        reqD.on("close", () => {
          console.log("D close");

          // E. the OPTIONAL slot, present and aborted mid-flight
          const ce = new AbortController();
          const initE: Init = { signal: ce.signal };
          const reqE = http.request(base + "/slow", {
            method: "GET",
            signal: initE.signal ?? undefined,
            agent: false,
          }, () => { console.log("E response (unexpected)"); });
          reqE.on("error", (e) => { describe("E", e); });
          reqE.on("close", () => {
            console.log("E close");

            // F. a custom reason carrying its own code: the request still
            //    gets the plain AbortError
            const cf = new AbortController();
            const reqF = http.request(base + "/slow", { signal: cf.signal, agent: false }, () => {
              console.log("F response (unexpected)");
            });
            reqF.on("error", (e) => { describe("F", e); });
            reqF.on("close", () => {
              const reason = cf.signal.reason as Coded;
              console.log("F close reason.name=" + reason.name + " reason.code=" + reason.code);

              // G. destroy() first: it wins, the later abort is a no-op
              const cg = new AbortController();
              const reqG = http.request(base + "/slow", { signal: cg.signal, agent: false }, () => {
                console.log("G response (unexpected)");
              });
              let nG = 0;
              // `code` is read here again. It was NAME and MESSAGE only
              // when this fixture landed: the bare destroy()'s 'socket
              // hang up' reached the listener through the runtime's
              // MESSAGE adapter, which recovers `code` by reading an
              // errno name back out of the text, and "socket hang up"
              // contains none — so it answered `undefined` where Node
              // answers ECONNRESET. The premature pass now mints the
              // ScrError with the code stamped and fires the OBJECT
              // (scr_http_client_hangup), which is the fix this comment
              // used to name, so the narrowing is gone and the whole
              // error is pinned.
              reqG.on("error", (e) => {
                nG++;
                describe("G#" + String(nG), e);
              });
              reqG.on("close", () => {
                console.log("G close errors=" + String(nG));

                // H. a user listener registered BEFORE the request sees a
                //    live request; one registered AFTER sees a dead one
                const ch = new AbortController();
                let reqH: http.ClientRequest | null = null;
                ch.signal.addEventListener("abort", () => {
                  console.log("H before-listener: destroyed=" + String(reqH !== null && reqH.destroyed));
                });
                reqH = http.request(base + "/slow", { signal: ch.signal, agent: false }, () => {
                  console.log("H response (unexpected)");
                });
                ch.signal.addEventListener("abort", () => {
                  console.log("H after-listener: destroyed=" + String(reqH !== null && reqH.destroyed));
                });
                reqH.on("error", (e) => { describe("H", e); });
                reqH.on("close", () => {
                  console.log("H close");

                  // I. write()/end() after the abort do not throw
                  const ci = new AbortController();
                  const reqI = http.request(base + "/slow", {
                    method: "POST", signal: ci.signal, agent: false,
                  }, () => { console.log("I response (unexpected)"); });
                  reqI.on("error", (e) => { describe("I", e); });
                  reqI.on("close", () => {
                    console.log("I close");
                    server.close();
                  });
                  reqI.write("one");
                  ci.abort();
                  console.log("I destroyed after abort=" + reqI.destroyed);
                  reqI.write("two");
                  reqI.end("three");
                  console.log("I write and end after the abort both returned");
                });
                reqH.end();
                setTimeout(() => { ch.abort(); }, 60);
              });
              reqG.end();
              setTimeout(() => {
                reqG.destroy();
                console.log("G destroy returned");
                cg.abort();
                console.log("G abort after destroy returned");
              }, 60);
            });
            reqF.end();
            setTimeout(() => { cf.abort(new Coded("mine")); }, 60);
          });
          reqE.end();
          setTimeout(() => { ce.abort(); }, 60);
        });
        reqD.end();
      });
      reqC.end();
    });
    reqB.end();
  });
  reqA.end();
  setTimeout(() => {
    console.log("A abort()");
    ca.abort();
    console.log("A abort returned");
  }, 60);
});
