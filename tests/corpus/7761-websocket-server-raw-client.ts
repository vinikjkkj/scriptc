// The WebSocket server cases a conforming CLIENT cannot produce, driven
// from a raw node:net socket that writes the frame bytes itself: a
// FRAGMENTED message (text + continuation), an UNMASKED client frame
// (which RFC 6455 5.1 forbids and the server must refuse with 1002), a
// PING the server must pong with the same payload, and a client that
// vanishes MID-FRAME — header written, payload never sent — which must
// leave the server draining cleanly rather than blocking on bytes that
// will not arrive.
//
// The raw client also AUDITS the server's bytes directly: every server
// frame's mask bit is asserted clear here, not merely tolerated by a
// library. 7760 is the same server against the runtime's native
// WebSocket client; this one is the wire itself.
import * as http from "node:http";
import * as net from "node:net";
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function hex(b: Buffer): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    const v = b[i] ?? 0;
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}

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
  return Buffer.concat([header, payload]);
}

function closeFrame(code: number, reason: string): Buffer {
  const r = Buffer.from(reason, "utf8");
  const p = Buffer.alloc(2 + r.length);
  p.writeUInt16BE(code, 0);
  r.copy(p, 2);
  return serverFrame(0x8, p, true);
}

// A CLIENT frame, masked with a fixed key so the bytes on the wire are
// reproducible (a real client uses fresh randomness; determinism is what
// this fixture needs and the server must not care either way).
function clientFrame(opcode: number, payload: Buffer, fin: boolean, mask: boolean): Buffer {
  const len = payload.length;
  const key = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  let hdrLen = 2;
  if (len >= 126 && len < 65536) hdrLen = 4;
  else if (len >= 65536) hdrLen = 10;
  const out = Buffer.alloc(hdrLen + (mask ? 4 : 0) + len);
  out[0] = (fin ? 0x80 : 0x00) | opcode;
  if (hdrLen === 2) out[1] = (mask ? 0x80 : 0x00) | len;
  else if (hdrLen === 4) { out[1] = (mask ? 0x80 : 0x00) | 126; out.writeUInt16BE(len, 2); }
  else { out[1] = (mask ? 0x80 : 0x00) | 127; out.writeUInt32BE(0, 2); out.writeUInt32BE(len, 6); }
  let off = hdrLen;
  if (mask) { key.copy(out, off); off += 4; }
  for (let i = 0; i < len; i++) out[off + i] = (payload[i] ?? 0) ^ (mask ? (key[i & 3] ?? 0) : 0);
  return out;
}

let conn = 0;
// How many bytes of the mid-frame client's announced frame the server is
// still holding when the peer vanishes. The frame declared 10 payload
// bytes and 3 arrived, so 6 header+mask bytes + 3 = 9 stay buffered and
// the server must NOT deliver a truncated message.
let midframePending = -1;

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(404);
  res.end();
});

server.on("upgrade", (req: http.IncomingMessage, socket, head: Buffer) => {
  conn += 1;
  const which = conn;
  const key = req.headers["sec-websocket-key"] ?? "";
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  console.log("S upgrade #" + String(which) + " url=" + String(req.url) + " head=" + String(head.length));
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  let buf: Buffer = Buffer.alloc(0);
  let fragOp = -1;
  let frag: Buffer = Buffer.alloc(0);

  // Connections 1 and 2 end from THIS side, and both lanes agree on the
  // event pair there. Connection 3 (the peer aborting mid-frame) does
  // NOT print its socket events: the compiled runtime emits 'close' on
  // an upgraded server socket after a peer abort and Node does not
  // (reduced repro in the block report; it is a net-layer lifecycle
  // divergence, not a framing one). What connection 3 asserts instead is
  // the SERVER-VISIBLE state — how many bytes of the announced frame are
  // still buffered — which both lanes do agree on and which is the fact
  // a truncated-frame bug would break.
  if (which !== 3) {
    socket.on("close", () => { console.log("S socket close #" + String(which)); });
    socket.on("end", () => { console.log("S socket end #" + String(which)); });
  }
  socket.on("error", () => socket.destroy());

  const onData = (chunk: Buffer): void => {
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
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
      let mask: Buffer = Buffer.alloc(4);
      if (masked) { if (buf.length < off + 4) return; mask = Buffer.from(buf.subarray(off, off + 4)); off += 4; }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) { for (let i = 0; i < len; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0); }
      buf = Buffer.from(buf.subarray(off + len));

      console.log("S in op=" + String(op) + " fin=" + String(fin) + " masked=" + String(masked) + " len=" + String(len));

      if (!masked) {
        console.log("S refusing unmasked client frame");
        socket.write(closeFrame(1002, "unmasked"));
        socket.end();
        return;
      }
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        if (op !== 0x0) { fragOp = op; frag = Buffer.alloc(0); }
        frag = Buffer.concat([frag, payload]);
        if (!fin) continue;
        console.log("S reassembled op=" + String(fragOp) + " text=" + frag.toString("utf8"));
        socket.write(serverFrame(fragOp, frag, true));
        frag = Buffer.alloc(0);
        fragOp = -1;
      } else if (op === 0x9) {
        socket.write(serverFrame(0xA, payload, true));
      } else if (op === 0x8) {
        socket.write(serverFrame(0x8, payload, true));
        socket.end();
        return;
      }
    }
  };
  socket.on("data", (chunk: Buffer) => {
    onData(chunk);
    if (which === 3) midframePending = buf.length;
  });
});

// A raw client: dials, handshakes, and reports every server frame's
// header bytes (so the mask bit is audited on the wire).
class RawClient {
  sock: net.Socket;
  head = "";
  up = false;
  buf: Buffer = Buffer.alloc(0);
  onFrame: ((op: number, fin: boolean, masked: boolean, payload: Buffer) => void) | null = null;
  onUp: (() => void) | null = null;
  tag: string;

  constructor(port: number, path: string, tag: string) {
    this.tag = tag;
    this.sock = net.createConnection({ port, host: "127.0.0.1" });
    this.sock.on("connect", () => {
      this.sock.write(
        "GET " + path + " HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });
    this.sock.on("data", (c: Buffer) => { this.feed(c); });
    this.sock.on("error", () => { this.sock.destroy(); });
  }

  feed(c: Buffer): void {
    if (!this.up) {
      this.head += c.toString("latin1");
      const i = this.head.indexOf("\r\n\r\n");
      if (i < 0) return;
      // RFC 6455 4.2.2: the accept for the fixed sample key.
      let acc = "";
      for (const line of this.head.slice(0, i).split("\r\n")) {
        const j = line.indexOf(":");
        if (j > 0 && line.slice(0, j).toLowerCase() === "sec-websocket-accept") acc = line.slice(j + 1).trim();
      }
      const want = createHash("sha1").update("dGhlIHNhbXBsZSBub25jZQ==" + GUID).digest("base64");
      console.log("C " + this.tag + " accept-ok=" + String(acc === want) + " (" + acc + ")");
      const rest = Buffer.from(this.head.slice(i + 4), "latin1");
      this.head = "";
      this.up = true;
      const u = this.onUp;
      this.onUp = null;
      if (u !== null) u();
      if (rest.length > 0) this.feed(rest);
      return;
    }
    this.buf = Buffer.concat([this.buf, c]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0] ?? 0;
      const b1 = this.buf[1] ?? 0;
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = this.buf.readUInt32BE(6); off = 10; }
      if (masked) { if (this.buf.length < off + 4) return; off += 4; }
      if (this.buf.length < off + len) return;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      console.log("C " + this.tag + " hdr=" + hex(Buffer.from(this.buf.subarray(0, off))) +
        " op=" + String(op) + " fin=" + String(fin) + " server-masked=" + String(masked));
      this.buf = Buffer.from(this.buf.subarray(off + len));
      const f = this.onFrame;
      if (f !== null) f(op, fin, masked, payload);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((r) => { setTimeout(() => { r(); }, ms); });
}

server.listen(0, "127.0.0.1", async () => {
  const port = (server.address() as { port: number }).port;

  // ── 1. a FRAGMENTED text message, then a ping ───────────────────────
  const c1 = new RawClient(port, "/frag", "c1");
  await new Promise<void>((r) => { c1.onUp = () => r(); });
  const got1: string[] = [];
  c1.onFrame = (op, _fin, _m, p) => {
    got1.push("op=" + String(op) + " " + p.toString("utf8"));
  };
  c1.sock.write(clientFrame(0x1, Buffer.from("frag-", "utf8"), false, true));
  await delay(40);
  c1.sock.write(clientFrame(0x0, Buffer.from("men", "utf8"), false, true));
  await delay(40);
  c1.sock.write(clientFrame(0x0, Buffer.from("ted", "utf8"), true, true));
  await delay(120);
  c1.sock.write(clientFrame(0x9, Buffer.from("pingpay", "utf8"), true, true));
  await delay(120);
  console.log("C c1 frames " + got1.join(" | "));
  c1.sock.write(clientFrame(0x8, Buffer.from([0x03, 0xe8]), true, true));
  await delay(150);
  c1.sock.destroy();
  await delay(60);

  // ── 2. an UNMASKED client frame: the server must refuse with 1002 ───
  const c2 = new RawClient(port, "/unmasked", "c2");
  await new Promise<void>((r) => { c2.onUp = () => r(); });
  c2.onFrame = (op, _fin, _m, p) => {
    if (op === 0x8) {
      console.log("C c2 close code=" + String(p.readUInt16BE(0)) + " reason=" + p.subarray(2).toString("utf8"));
    }
  };
  c2.sock.write(clientFrame(0x1, Buffer.from("naked", "utf8"), true, false));
  await delay(200);
  c2.sock.destroy();
  await delay(60);

  // ── 3. a client that vanishes MID-FRAME ─────────────────────────────
  const c3 = new RawClient(port, "/midframe", "c3");
  await new Promise<void>((r) => { c3.onUp = () => r(); });
  // A 10-byte payload announced, 3 bytes delivered, then the socket dies.
  const partial = clientFrame(0x1, Buffer.from("0123456789", "utf8"), true, true);
  c3.sock.write(Buffer.from(partial.subarray(0, 2 + 4 + 3)));
  await delay(80);
  c3.sock.destroy();
  await delay(200);
  console.log("S midframe pending=" + String(midframePending) + " (no message delivered)");

  server.close();
  await delay(150);
  console.log("returned");
});
