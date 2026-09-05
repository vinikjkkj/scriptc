// The REAL client: Node's own built-in WebSocket (undici's), never the
// runtime's. Every judgement below — the 101 was accepted, the accept key
// verified, a frame at each length form parsed, a fragmented server
// message reassembled, a ping answered, the closing handshake completed —
// is made by an implementation that has never seen the server's code.
// A wrong opcode, a mask bit set on a server frame, or a length field in
// the wrong form makes this client fail the connection instead of
// printing, and the fixture's three-leg diff turns red.
const port = Number(process.argv[2]);

const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
ws.binaryType = "arraybuffer";

const inbox = [];
let waiter = null;
ws.addEventListener("message", (e) => {
  let line;
  if (typeof e.data === "string") {
    let s = 0;
    for (let i = 0; i < e.data.length; i++) s = (s + e.data.charCodeAt(i)) & 0xff;
    line = `text len=${e.data.length} sum=${s}`;
  } else {
    const u = new Uint8Array(e.data);
    let s = 0;
    for (let i = 0; i < u.length; i++) s = (s + u[i]) & 0xff;
    line = `bin len=${u.length} sum=${s}`;
  }
  if (waiter) { const w = waiter; waiter = null; w(line); } else inbox.push(line);
});
const next = () =>
  new Promise((resolve) => {
    const q = inbox.shift();
    if (q !== undefined) resolve(q);
    else waiter = resolve;
  });

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error("ws error before open")), { once: true });
});
console.log("open");

// Every length form the RFC defines, at both sides of each boundary.
for (const n of [0, 1, 125, 126, 127, 65535, 65536]) {
  ws.send("a".repeat(n));
  console.log(`text ${n} -> ${await next()}`);
}
for (const n of [125, 126, 65536]) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = i & 0xff;
  ws.send(u);
  console.log(`bin ${n} -> ${await next()}`);
}

// A FRAGMENTED server message must arrive as ONE message event.
ws.send("split-me");
console.log(`fragmented -> ${await next()}`);

// A server PING: this client auto-pongs, and the server prints it.
ws.send("ping-me");
await new Promise((r) => setTimeout(r, 250));
console.log("ping sent, pong left to the server's log");

// The closing handshake, client first.
const closed = new Promise((resolve) => {
  ws.addEventListener("close", (e) => resolve(`close code=${e.code} reason=${e.reason} clean=${e.wasClean}`), {
    once: true,
  });
});
ws.close(1000, "bye");
console.log(await closed);
console.log("driver done");
