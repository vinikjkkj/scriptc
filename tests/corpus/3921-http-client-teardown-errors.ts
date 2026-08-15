// The http client's premature-teardown pass: the error a hang-up carries,
// and the event shape of a teardown that lands MID-BODY.
//
// Every line here was MEASURED against Node v25.9.0 before a line of the
// implementation changed (repro-ef/n1.mjs, n2.mjs, n3.mjs, n4.mjs), and
// three of the properties are ones a plausible implementation gets wrong:
//
//   * a hang-up before any response head is `Error: socket hang up` with
//     `code: 'ECONNRESET'`. The code is NOT recoverable from the message
//     — an implementation that fans the error out as a STRING and lets
//     the shared adapter read an errno name back out of the text answers
//     `code: undefined` here, because "socket hang up" contains no errno
//     name. That is exactly what this slice did before.
//
//   * a teardown that lands mid-BODY does not produce a request 'error'
//     at all when it came from a bare destroy(); the response's own
//     ECONNRESET is the only error in the window. destroy(err) DOES add
//     one — the user's object, first.
//
//   * the order is res 'aborted', then the request's 'close', then the
//     response's `Error: aborted` / ECONNRESET, then the response's
//     'close'. Putting the request's 'close' first (the obvious reading
//     of "the request is done") reorders three of the four.
//
// `res.aborted` flips to true at its own event and `res.complete` stays
// false throughout — both read here, because a teardown that forgot the
// flag would still emit every event in the right order.
//
// NOT printed, deliberately: the `code` of the object handed to
// destroy(err). A user Error subclass that declares its own `code` field
// gets a slot of its own, laid out AFTER ScrError's `%code` prefix slot
// (lower-classes.ts's registerBuiltinErrorClasses says so in as many
// words), so the value is readable through the SUBCLASS type and absent
// through the `%Error` view every listener actually receives. Node has
// one property and answers it either way. That is a pre-existing root of
// its own — it predates this fixture, it is not specific to destroy(err)
// or to http, and the pre-head destroy(err) path that landed several
// blocks ago answers `undefined` for the same reason — so it is measured
// and reported rather than papered over here. `name` and `message` DO
// travel, and are printed.
import * as http from "node:http";

class Coded extends Error {
  code: string;
  constructor(msg: string) {
    super(msg);
    this.name = "Coded";
    this.code = "E_MINE";
  }
}

const log: string[] = [];

function describe(tag: string, e: Error): void {
  log.push(
    tag + " name=" + e.name +
    " message=" + e.message +
    " code=" + (e as NodeJS.ErrnoException).code,
  );
}

// name/message only — see the header on why `code` is not read here
function describeObject(tag: string, e: Error): void {
  log.push(tag + " name=" + e.name + " message=" + e.message + " isError=" + (e instanceof Error));
}

const server = http.createServer((req, res) => {
  if (req.url === "/hang") {
    // never answers: the request waits for a head that never comes
    return;
  }
  // a head, then a PARTIAL body — content-length promises 1000
  res.writeHead(200, { "content-length": "1000", "content-type": "text/plain" });
  res.write("xxxxxxxxxx");
});

server.listen(0, () => {
  const port = server.address().port;

  // A. bare destroy() BEFORE any response head → 'socket hang up'
  const reqA = http.request({ port, path: "/hang", agent: false }, () => {
    log.push("A response (unexpected)");
  });
  reqA.on("error", (e) => { describe("A", e); });
  reqA.on("close", () => {
    log.push("A close");

    // B. bare destroy() MID-BODY: no request 'error' at all
    const reqB = http.request({ port, path: "/body", agent: false }, (res) => {
      log.push("B response status=" + String(res.statusCode) + " complete=" + res.complete);
      res.on("data", (chunk) => { log.push("B data " + String(chunk.length)); });
      res.on("aborted", () => {
        log.push("B res aborted aborted=" + res.aborted + " complete=" + res.complete);
      });
      res.on("error", (e) => { describe("B res", e); });
      res.on("end", () => { log.push("B res end (unexpected)"); });
      res.on("close", () => {
        log.push("B res close aborted=" + res.aborted + " complete=" + res.complete);
      });
      setTimeout(() => { reqB.destroy(); }, 100);
    });
    reqB.on("error", (e) => { describe("B req", e); });
    reqB.on("close", () => {
      log.push("B req close");

      // C. destroy(err) MID-BODY: the user's object lands on the REQUEST
      //    first, and the response still gets its own ECONNRESET
      const reqC = http.request({ port, path: "/body", agent: false }, (res) => {
        log.push("C response status=" + String(res.statusCode));
        res.on("data", (chunk) => { log.push("C data " + String(chunk.length)); });
        res.on("aborted", () => { log.push("C res aborted aborted=" + res.aborted); });
        res.on("error", (e) => { describe("C res", e); });
        // the response's 'close' is the LAST event of the exchange — the
        // whole transcript prints from here
        res.on("close", () => {
          log.push("C res close complete=" + res.complete);
          for (const line of log) console.log(line);
          server.close();
        });
        setTimeout(() => { reqC.destroy(new Coded("my teardown")); }, 100);
      });
      reqC.on("error", (e) => { describeObject("C req", e); });
      reqC.on("close", () => { log.push("C req close"); });
      reqC.end();
    });
    reqB.end();
  });
  reqA.end();
  setTimeout(() => { reqA.destroy(); }, 150);
});
