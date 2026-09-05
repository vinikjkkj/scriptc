/* A WebSocket SERVER on the 'upgrade' seam, probed by a REAL client.
 *
 * The runtime's WebSocket is a CLIENT (scr_websocket.c: masking is a
 * client obligation, and scr_ws_accept_key exists only to validate a
 * server's reply). Nothing served. This fixture is the serving
 * direction — 101 with the computed Sec-WebSocket-Accept, UNMASKED
 * outbound frames, masked inbound ones unmasked — and it is deliberately
 * NOT probed by the runtime's own client: driver.mjs uses Node's
 * built-in WebSocket, so a mis-framed length field or a stray mask bit
 * is judged by an implementation that has never seen this code.
 *
 * The server prints only its own view; the driver prints the client's.
 * Both are compared byte-for-byte between the Node lane and the compiled
 * lane, which is what makes "the compiled server frames correctly" a
 * measured fact rather than an assumption. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function hex(b: Buffer): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    const v = b[i] ?? 0;
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}

/* One server frame: never masked, shortest length form. */
function serverFrame(opcode: number, payload: Buffer, fin: boolean): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  console.log(`out hdr=${hex(header)} len=${len}`);
  return Buffer.concat([header, payload]);
}

function sum8(b: Buffer): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s = (s + (b[i] ?? 0)) & 0xff;
  return s;
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  console.log(`plain ${req.method} ${req.url}`);
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("upgrade required");
});

server.on("upgrade", (req: IncomingMessage, socket, head: Buffer) => {
  const key = req.headers["sec-websocket-key"] ?? "";
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  console.log(`upgrade ${req.url} head=${head.length} version=${req.headers["sec-websocket-version"]}`);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let buf: Buffer = Buffer.alloc(0);
  let fragOp = -1;
  let frag: Buffer = Buffer.alloc(0);

  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0] ?? 0;
      const b1 = buf[1] ?? 0;
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        if (buf.readUInt32BE(2) !== 0) { socket.destroy(); return; }
        len = buf.readUInt32BE(6);
        off = 10;
      }
      let mask: Buffer = Buffer.alloc(4);
      if (masked) {
        if (buf.length < off + 4) return;
        mask = Buffer.from(buf.subarray(off, off + 4));
        off += 4;
      }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) {
        for (let i = 0; i < len; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
      }
      buf = Buffer.from(buf.subarray(off + len));

      console.log(`in op=${op} fin=${fin} masked=${masked} len=${len} sum=${sum8(payload)}`);
      if (!masked) {
        // RFC 6455 §5.1: a client frame that is not masked is a protocol
        // error. Node's own client never sends one; the check stays so
        // the server is not merely permissive.
        socket.end();
        return;
      }
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        if (op !== 0x0) { fragOp = op; frag = Buffer.alloc(0); }
        frag = Buffer.concat([frag, payload]);
        if (!fin) continue;
        const whole = frag;
        const wholeOp = fragOp;
        frag = Buffer.alloc(0);
        fragOp = -1;
        if (wholeOp === 0x1 && whole.toString("utf8") === "ping-me") {
          socket.write(serverFrame(0x9, Buffer.from("pv", "utf8"), true));
          continue;
        }
        if (wholeOp === 0x1 && whole.toString("utf8") === "split-me") {
          // A FRAGMENTED server message: text (no FIN) + continuation.
          socket.write(serverFrame(0x1, Buffer.from("frag", "utf8"), false));
          socket.write(serverFrame(0x0, Buffer.from("mented", "utf8"), true));
          continue;
        }
        socket.write(serverFrame(wholeOp, whole, true));
      } else if (op === 0x9) {
        socket.write(serverFrame(0xa, payload, true));
      } else if (op === 0xa) {
        console.log(`pong ${payload.toString("utf8")}`);
      } else if (op === 0x8) {
        const code = len >= 2 ? payload.readUInt16BE(0) : 1005;
        console.log(`close from client code=${code} reason=${len > 2 ? payload.subarray(2).toString("utf8") : ""}`);
        socket.write(serverFrame(0x8, payload.subarray(0, Math.min(2, len)), true));
        socket.end();
        server.close(() => console.log("server closed"));
        return;
      }
    }
  });
});

server.listen(0, () => {
  console.log("listening");
  process.stderr.write(`PORT ${(server.address() as { port: number }).port}\n`);
});
