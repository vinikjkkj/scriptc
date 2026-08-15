/* The `signal` option over TLS — the leg a corpus program cannot reach,
 * because the abort has to tear down a real handshake rather than a
 * loopback socket.
 *
 * Three points in the exchange, each against the fixture's self-signed
 * chain with the CA pinned (so verification is ON and the dial is a full
 * handshake):
 *
 *   mid-flight   the server holds the response back; the abort lands while
 *                the request is waiting on a TLS connection that is fully
 *                established. The listener must reach through the seam
 *                (scr_abort_http.c) and destroy a socket the TLS layer
 *                owns, and the AbortError must still carry ABORT_ERR.
 *   pre-aborted  the signal is already aborted when the request is built:
 *                the handshake is torn down before it completes, and the
 *                server must never see a request.
 *   completed    an abort after the response is a no-op, and the request
 *                that follows it on the same signal is unaffected — the
 *                request removed its own listener and nobody else's.
 *
 * The count the server prints is what separates "the request was torn
 * down" from "the request was sent and its answer thrown away". */
import * as https from "node:https";
import { readFileSync } from "node:fs";

const cert = readFileSync("tests/fixtures/server/certs/localhost.pem");
const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const ca = readFileSync("tests/fixtures/server/certs/ca.pem");

let served = 0;

const secure = https.createServer({ cert, key }, (req, res) => {
  served++;
  if (req.url === "/slow") {
    setTimeout(() => {
      res.writeHead(200);
      res.end("late");
    }, 1500);
    return;
  }
  res.writeHead(200);
  res.end("ok");
});

interface Outcome {
  readonly kind: string;
  readonly detail: string;
}

/** One request with a signal; resolves what actually happened. */
function probe(port: number, path: string, signal: AbortSignal, abortAfterMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const req = https.request(
      `https://localhost:${port}${path}`,
      { method: "GET", rejectUnauthorized: true, ca, signal },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ kind: "response", detail: String(res.statusCode) }));
      },
    );
    req.on("error", (e) =>
      resolve({ kind: "error", detail: `${e.name}/${(e as NodeJS.ErrnoException).code}/${e.message}` }));
    req.end();
    if (abortAfterMs >= 0) {
      setTimeout(() => {
        // A controller is not reachable from the signal, so the caller
        // aborts through the one it owns — see main().
      }, abortAfterMs);
    }
  });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

async function main(port: number): Promise<void> {
  // 1. mid-flight, on a fully established TLS connection
  const a = new AbortController();
  const midFlight = probe(port, "/slow", a.signal, -1);
  await wait(120);
  a.abort();
  const one = await midFlight;
  console.log("mid-flight:", one.kind, one.detail);

  // 2. the signal is already aborted: the server must never be reached
  const before = served;
  const b = new AbortController();
  b.abort();
  const two = await probe(port, "/fast", b.signal, -1);
  await wait(120);
  console.log("pre-aborted:", two.kind, two.detail, "served-delta", served - before);

  // 3. a completed request, then an abort that changes nothing, then
  //    another request on the SAME signal (which is now aborted, so it
  //    tears down at once — the signal is sticky, exactly like Node)
  const c = new AbortController();
  const three = await probe(port, "/fast", c.signal, -1);
  console.log("completed:", three.kind, three.detail);
  c.abort();
  console.log("abort after completion returned, aborted", c.signal.aborted);
  const four = await probe(port, "/fast", c.signal, -1);
  console.log("reused aborted signal:", four.kind, four.detail);

  console.log("served", served);
  secure.close(() => console.log("done"));
}

secure.listen(0, () => {
  main(secure.address().port);
});
