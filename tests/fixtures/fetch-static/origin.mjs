// The fetch fixture server: one http origin, one https origin with a
// self-signed cert (the TLS-failure leg), and a second http origin (the
// cross-origin redirect leg). Prints "PORTS <http> <https> <alt>" on stderr.
import { createServer } from "node:http";
import { createServer as createHttps } from "node:https";
import { gzipSync, deflateSync } from "node:zlib";
import { generateKeyPairSync, X509Certificate, createSign } from "node:crypto";
import { execFileSync } from "node:child_process";

const BODY = "hello world";
const BIG = "x".repeat(70000);

function routes(req, res, origin, alt) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  if (p === "/ok") { res.writeHead(200, { "content-type": "text/plain" }); res.end(BODY); return; }
  if (p === "/404") { res.writeHead(404, { "content-type": "text/plain" }); res.end("nope"); return; }
  if (p === "/500") { res.writeHead(500); res.end("boom"); return; }
  if (p === "/204") { res.writeHead(204); res.end(); return; }
  if (p === "/big") { res.writeHead(200, { "content-length": String(BIG.length) }); res.end(BIG); return; }
  if (p === "/chunked") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("aaa"); res.write("bbbb"); res.write("ccccc");
    setTimeout(() => { res.write("ddddd"); res.end("e"); }, 20);
    return;
  }
  if (p === "/gzip") {
    const z = gzipSync(Buffer.from(BIG));
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(z.length) });
    res.end(z); return;
  }
  if (p === "/deflate") {
    const z = deflateSync(Buffer.from(BODY));
    res.writeHead(200, { "content-encoding": "deflate", "content-length": String(z.length) });
    res.end(z); return;
  }
  if (p === "/redir302") { res.writeHead(302, { location: "/ok" }); res.end("ignored body"); return; }
  if (p === "/redir301") { res.writeHead(301, { location: "/echo" }); res.end(); return; }
  if (p === "/redir303") { res.writeHead(303, { location: "/echo" }); res.end(); return; }
  if (p === "/redir307") { res.writeHead(307, { location: "/echo" }); res.end(); return; }
  if (p === "/redirrel") { res.writeHead(302, { location: "ok" }); res.end(); return; }
  if (p === "/redirloop") { res.writeHead(302, { location: "/redirloop" }); res.end(); return; }
  if (p === "/redircross") { res.writeHead(302, { location: alt + "/echo" }); res.end(); return; }
  if (p === "/redirnoloc") { res.writeHead(302, { "content-type": "text/plain" }); res.end("threeohtwo"); return; }
  if (p === "/headers") {
    res.writeHead(200, { "X-Mixed-Case": "One", "x-repeat": ["a", "b"], "content-type": "text/plain" });
    res.end("h"); return;
  }
  if (p === "/json") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"a":[1,2],"b":"z"}'); return; }
  if (p === "/badjson") { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); return; }
  if (p === "/slow") { setTimeout(() => { res.writeHead(200); res.end("late"); }, 5000); return; }
  if (p === "/echo") {
    let body = "";
    req.on("data", (c) => { body += c.toString("utf8"); });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`m=${req.method} b=${body} ua=${req.headers["user-agent"] ?? "-"} ` +
              `au=${req.headers["authorization"] ?? "-"} xt=${req.headers["x-test"] ?? "-"} ` +
              `ct=${req.headers["content-type"] ?? "-"} ae=${req.headers["accept-encoding"] ?? "-"}`);
    });
    return;
  }
  res.writeHead(400); res.end("?");
}

// A self-signed cert so the https leg is a REAL verification failure.
function selfSigned() {
  const out = execFileSync(process.env.OPENSSL_BIN ?? "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-keyout", "-", "-out", "-", "-days", "2",
     "-nodes", "-subj", "/CN=localhost"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const key = out.slice(out.indexOf("-----BEGIN PRIVATE KEY-----"), out.indexOf("-----END PRIVATE KEY-----") + 25);
  const cert = out.slice(out.indexOf("-----BEGIN CERTIFICATE-----"));
  return { key, cert };
}

const alt = createServer((q, s) => routes(q, s, "alt", ""));
alt.listen(0, "127.0.0.1", () => {
  const altPort = alt.address().port;
  const altOrigin = `http://127.0.0.1:${altPort}`;
  const main = createServer((q, s) => routes(q, s, "main", altOrigin));
  main.listen(0, "127.0.0.1", () => {
    let tls = null;
    try {
      const { key, cert } = selfSigned();
      tls = createHttps({ key, cert }, (q, s) => routes(q, s, "tls", altOrigin));
    } catch { tls = null; }
    const finish = (tlsPort) => {
      process.stderr.write(`PORTS ${main.address().port} ${tlsPort} ${altPort}\n`);
    };
    if (tls) tls.listen(0, "127.0.0.1", () => finish(tls.address().port));
    else finish(0);
  });
});
