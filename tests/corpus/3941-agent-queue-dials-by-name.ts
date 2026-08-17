// The http agent's maxSockets QUEUE dials the host it was handed, and the
// host an agent request carries is a NAME. The queued socket is created
// first and dials LATER, when a slot frees, so its dial has to be able to
// do everything the immediate one can — resolution included. It could
// not: a queued request answered "getaddrinfo ENOTFOUND <name>" while the
// identical request answered 200 whenever a slot happened to be free.
//
// "localhost" is the only name a fixture can rely on, and it takes the
// short-circuit rather than the resolver — so what this pins is that the
// deferred dial still reaches the wire at all, in order, with the queue
// serialising three requests through one socket.
import * as http from "node:http";

// The port is EPHEMERAL, like every other listening fixture in the corpus
// (of the 33 that listen, 31 spell it `listen(0` and one `{ port: 0 }`;
// this was the only fixed one). This one hardcoded 18994, and it is run more
// than once at a time — the C and LLVM lanes cover the same corpus, and
// agents run lanes concurrently — so the loser of the race died on
// EADDRINUSE before the listen callback, printing NOTHING. That looked
// like a backend disagreement (empty stdout on one lane, three correct
// lines on the other) from a program that passed the C-vs-Node
// differential whenever it happened to get the port. Dialing by NAME is
// what the fixture pins, and that is the `host` below, not the port.
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok " + String(req.url));
});

server.listen(0, "127.0.0.1", () => {
  const PORT = server.address().port;
  const agent = new http.Agent({ maxSockets: 1, keepAlive: false });
  let left = 3;
  const fire = (tag: string): void => {
    const r = http.request({ host: "localhost", port: PORT, path: "/" + tag, agent }, (res) => {
      let bytes = 0;
      res.on("data", (c: Buffer) => { bytes += c.length; });
      res.on("end", () => {
        console.log(tag, res.statusCode, bytes);
        left--;
        if (left === 0) { agent.destroy(); server.close(); }
      });
    });
    r.on("error", (e: Error) => {
      console.log(tag, "ERROR", e.message);
      left--;
      if (left === 0) { agent.destroy(); server.close(); }
    });
    r.end();
  };
  fire("a");
  fire("b");
  fire("c");
});
