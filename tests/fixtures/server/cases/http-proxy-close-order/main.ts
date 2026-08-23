/* http-proxy-pipe's shutdown close-ORDER, with the coincidence pinned.
 *
 * The sibling fixture http-proxy-pipe closes a busy server (the proxy,
 * whose /quit connection is still up) and then a drained one (the
 * backend). Node emits the DRAINED one's 'close' first, because
 * _emitCloseIfDrained schedules it on a next tick while the busy one has
 * to wait for its socket. This runtime settles servers out of the net
 * sweep, and the order used to depend on whether the proxy's connection
 * happened to die in the same sweep pass as the backend's pending settle:
 * a coincidence, so http-proxy-pipe printed the two lines the wrong way
 * round SOME of the time and no single-sample gate could own it. It was
 * measured at 17 reversals in 100 on a loaded host and at 1 in 100 here.
 *
 * This fixture is the same program with one line added: the /quit handler
 * destroys its own request socket once the reply is written, which makes
 * the proxy drain in exactly the pass where the backend's settle is
 * pending. The coincidence becomes the rule. Before the fix it printed
 * "proxy closed" then "backend closed" on 60 runs out of 60; after it,
 * "backend closed" then "proxy closed" on 310 out of 310, which is what
 * Node prints on 255 out of 255.
 *
 * The destroy is not a truncation risk: it runs after res.end() has
 * written the three-byte reply, and the driver's compared stdout was
 * byte-identical across all of those runs on both lanes. */
import * as http from "node:http";
import * as net from "node:net";

let backendPort = 0;

const backend = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  let body = "";
  req.on("data", (c: Buffer) => {
    body += c.toString("utf8");
  });
  req.on("end", () => {
    console.log(`backend ${req.method} ${req.url} host=${req.headers.host} body=${body}`);
    res.writeHead(200, { "content-type": "text/plain", "x-backend": "1" });
    res.end(`echo ${req.method} ${req.url} body=${body}`);
  });
});

const proxy = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.url === "/quit") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("bye");
    proxy.close(() => console.log("proxy closed"));
    backend.close(() => console.log("backend closed"));
    // The pin: this request's own socket dies now, so the proxy drains in
    // the SAME sweep pass in which the backend's settle is already due.
    req.socket.destroy();
    return;
  }
  const proxyReq = http.request(
    {
      createConnection: () => net.connect(backendPort),
      path: req.url,
      method: req.method,
      headers: { host: "backend.localhost" },
    },
    (proxyRes: http.IncomingMessage) => {
      const sc = proxyRes.statusCode;
      res.writeHead(sc === undefined ? 502 : sc, { "x-proxied": "1" });
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("bad gateway");
    }
  });
  req.pipe(proxyReq);
});

backend.listen(0, () => {
  backendPort = backend.address().port;
  proxy.listen(0, () => {
    console.log("listening");
    process.stderr.write(`PORT ${proxy.address().port}\n`);
  });
});
