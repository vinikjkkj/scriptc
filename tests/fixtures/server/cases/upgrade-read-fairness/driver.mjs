import net from "node:net";

const CLIENTS = 8;
const payload = Buffer.alloc(1024 * 1024, 0x61);
const port = Number(process.argv[2]);
const sockets = [];
let closed = 0;

function flood(socket) {
  if (socket.destroyed) return;
  if (socket.write(payload)) setImmediate(() => flood(socket));
  else socket.once("drain", () => flood(socket));
}

for (let i = 0; i < CLIENTS; i++) {
  const socket = net.connect(port, "127.0.0.1");
  let handshake = "";
  socket.on("connect", () => {
    socket.write(
      `GET /${i} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    );
  });
  socket.on("data", (chunk) => {
    if (handshake.endsWith("\r\n\r\n")) return;
    handshake += chunk.toString("latin1");
    if (!handshake.includes("\r\n\r\n")) return;
    flood(socket);
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    closed++;
    if (closed === CLIENTS) {
      clearTimeout(watchdog);
      console.log(`driver closed ${closed} sockets`);
    }
  });
  sockets.push(socket);
}

// Failure-only guard. The server program owns the happy-path teardown: it
// destroys every upgraded socket after its own ticks, which closes all 8
// clients and clears this timer. The bound must stay far above the slowest
// legitimate run (ASan on a starved core) so that it never fires there: if it
// did, the server would observe a peer close BEFORE printing and the output
// would depend on CPU speed, not on read fairness. It fires only when the
// native loop is genuinely monopolized by the flood (the guarded defect), in
// which case the destroyed peers make the printed line differ from Node's.
const watchdog = setTimeout(() => {
  for (const socket of sockets) socket.destroy();
}, 20_000);
