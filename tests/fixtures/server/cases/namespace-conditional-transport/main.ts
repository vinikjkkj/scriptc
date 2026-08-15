/* zapo's WaMediaTransferClient.httpRequest shape, verbatim: the module
 * NAMESPACE is chosen from the parsed URL —
 *
 *   const transport = parsed.protocol === 'https:' ? https : http
 *   transport.request(url, { method, headers }, (res) => ...)
 *
 * — and ONE binding serves both schemes. There is no module object in a
 * compiled binary, so the declaration lowers to its CONDITION (evaluated
 * exactly once, in source order) and the call lowers once per arm under
 * a ternary on that selector.
 *
 * Both arms are dialed for real here: a plain http server and a TLS one
 * with the fixture chain, driven through the same binding, plus a
 * refused port on each arm. Driver-less: the program is its own client. */
import * as http from "node:http";
import * as https from "node:https";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const cert = readFileSync("tests/fixtures/server/certs/localhost.pem");
const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const ca = readFileSync("tests/fixtures/server/certs/ca.pem");

const plain = http.createServer((req, res) => {
  res.writeHead(200, { "x-echo": `plain ${req.method} ${req.url}` });
  res.end();
});
const secure = https.createServer({ cert, key }, (req, res) => {
  res.writeHead(200, { "x-echo": `tls ${req.method} ${req.url}` });
  res.end();
});

function fetchThrough(url: string, method: string): Promise<string> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  return new Promise<string>((resolve) => {
    const req = transport.request(
      url,
      { method, timeout: 3000, headers: { "x-probe": "1" }, rejectUnauthorized: false, ca },
      (res) => {
        res.resume();
        resolve(`${res.statusCode} ${res.headers["x-echo"]}`);
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

async function main(plainPort: number, securePort: number, freePort: number): Promise<void> {
  console.log("plain arm:", await fetchThrough(`http://127.0.0.1:${plainPort}/a?q=1`, "GET"));
  console.log("tls arm:", await fetchThrough(`https://localhost:${securePort}/b`, "HEAD"));
  console.log("plain arm again:", await fetchThrough(`http://127.0.0.1:${plainPort}/c`, "DELETE"));
  console.log("plain refused:", await fetchThrough(`http://127.0.0.1:${freePort}/d`, "GET"));
  console.log("tls refused:", await fetchThrough(`https://127.0.0.1:${freePort}/e`, "GET"));
  plain.close();
  secure.close(() => console.log("done"));
}

plain.listen(0, () => {
  const plainPort = plain.address().port;
  secure.listen(0, () => {
    const securePort = secure.address().port;
    const free = createServer();
    free.listen(0, () => {
      const freePort = free.address().port;
      free.close(() => {
        main(plainPort, securePort, freePort);
      });
    });
  });
});
