import * as net from "node:net";
// A client that asks for TCP_NODELAY BEFORE connecting (pg's Connection.connect does) must not pay Nagle's delayed-ACK stall
// on a request written as two small segments. 60 round trips of two writes: with the option the whole run is far under
// the ~40 ms per round trip a stall costs.
const ROUNDS = 60;
const server = net.createServer((sock) => {
  let got = 0;
  sock.on("data", (d: Buffer) => {
    got += d.length;
    while (got >= 8) {
      got -= 8;
      sock.write("ok");
    }
  });
});
server.listen(0, "127.0.0.1", () => {
  const port = (server.address() as { port: number }).port;
  const c = new net.Socket();
  c.setNoDelay(true);
  let replies = 0;
  const t0 = Date.now();
  const next = (): void => {
    c.write("abcd");
    c.write("efgh");
  };
  c.on("data", () => {
    replies++;
    if (replies === ROUNDS) {
      const ms = Date.now() - t0;
      console.log("rounds", replies, "fast", ms < 1200);
      c.destroy();
      server.close();
    } else next();
  });
  c.connect(port, "127.0.0.1", next);
});
