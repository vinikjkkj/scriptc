/* The three-argument client form over TLS: `https.request(url, options,
 * callback)`. The URL supplies host/port/path through the same parse the
 * two-argument URL form uses (and the same module-checked scheme —
 * https.request of an http: URL is ERR_INVALID_PROTOCOL); the options
 * record supplies method, headers, timeout and the https extras
 * (rejectUnauthorized, ca).
 *
 * Probed against the self-signed chain with verification off, against
 * the SAME chain with the fixture CA pinned (verification ON — the leg
 * that proves the ca option still reaches the client through this row),
 * against the wrong protocol, and against a refused port. Driver-less:
 * the program is its own client. */
import * as https from "node:https";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const ECHO_HEADER = "X-Echo";
const SOCKET_TIMEOUT_MS = 3000;

const cert = readFileSync("tests/fixtures/server/certs/localhost.pem");
const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const ca = readFileSync("tests/fixtures/server/certs/ca.pem");

const secure = https.createServer({ cert, key }, (req, res) => {
  res.writeHead(200, { [ECHO_HEADER]: `${req.method} ${req.url}` });
  res.end();
});

/** One request through the three-argument form; resolves the echoed
 * method+path, or a short reason. */
function probe(url: string, method: string, verify: boolean): Promise<string> {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method,
        timeout: SOCKET_TIMEOUT_MS,
        headers: { "x-probe": "1" },
        rejectUnauthorized: verify,
        ca,
      },
      (res) => {
        res.resume();
        resolve(`${res.statusCode} ${res.headers[ECHO_HEADER.toLowerCase()]}`);
      },
    );
    req.on("error", () => resolve("error"));
    req.on("timeout", () => {
      req.destroy();
      resolve("timeout");
    });
    req.end();
  });
}

async function main(securePort: number, freePort: number): Promise<void> {
  console.log("verify off:", await probe(`https://localhost:${securePort}/a?q=1`, "GET", false));
  console.log("verify on, ca pinned:", await probe(`https://localhost:${securePort}/b`, "HEAD", true));
  console.log("method through:", await probe(`https://localhost:${securePort}/c`, "DELETE", false));
  console.log("refused:", await probe(`https://127.0.0.1:${freePort}/d`, "GET", false));
  // The scheme is the calling MODULE's: an http: URL through https.request
  // is Node's ERR_INVALID_PROTOCOL, catchably, in the three-argument form
  // exactly as in the two-argument one.
  try {
    https.request(`http://localhost:${securePort}/e`, { method: "GET" }, () => {});
  } catch (e) {
    console.log("scheme:", (e as Error).message);
  }
  secure.close(() => console.log("done"));
}

secure.listen(0, () => {
  const securePort = secure.address().port;
  // An ephemeral port nothing listens on: bind, note, release.
  const free = createServer();
  free.listen(0, () => {
    const freePort = free.address().port;
    free.close(() => {
      main(securePort, freePort);
    });
  });
});
