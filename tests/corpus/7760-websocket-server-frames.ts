// A WebSocket SERVER, compiled. The runtime ships a WebSocket CLIENT
// (scr_websocket.c's codec is the client half by construction: masking is
// a client obligation, and scr_ws_accept_key exists only to VALIDATE a
// server's reply). Serving is the other direction — accept the HTTP
// upgrade, answer with the computed Sec-WebSocket-Accept, and emit
// UNMASKED frames — and nothing in the corpus exercised it.
//
// This program is both halves in one process: an http.createServer whose
// 'upgrade' listener takes the socket raw and speaks RFC 6455 as a
// server, dialled by the runtime's OWN native WebSocket client. The two
// halves are independent implementations (TypeScript framing on one side,
// scr_websocket.c on the other), so the client accepting a frame is a
// real check on the server's bytes and not self-agreement.
//
// Every outbound header is printed as hex, so stdout is a wire-format
// assertion and not merely a behavioural one: the 7-bit, 16-bit and
// 64-bit length forms are pinned at the 125 / 126 / 65535 / 65536
// boundaries, the mask bit is pinned CLEAR on every server frame (RFC
// 6455 5.1: a server MUST NOT mask), and the inbound mask bit is pinned
// SET on every client frame.
import * as http from "node:http";
import { createHash } from "node:crypto";

interface WSEventLike {
  readonly code?: number
  readonly reason?: string
  readonly wasClean?: boolean
  readonly data?: unknown
}
interface RawWS {
  binaryType: string
  readyState: number
  onopen: ((e: WSEventLike) => void) | null
  onclose: ((e: WSEventLike) => void) | null
  onerror: ((e: WSEventLike) => void) | null
  onmessage: ((e: WSEventLike) => void) | null
  close(code?: number, reason?: string): void
  send(data: string | ArrayBuffer | Uint8Array): void
}
type RawWSCtor = new (url: string, protocols?: string | readonly string[]) => RawWS
const WS = (globalThis as typeof globalThis & { WebSocket?: RawWSCtor }).WebSocket as RawWSCtor

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function hex(b: Buffer): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    const v = b[i] ?? 0;
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}

// One SERVER frame: FIN as asked, never masked, the shortest length form
// the payload allows (RFC 6455 5.2 requires the minimal form).
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
  console.log("out hdr=" + hex(header) + " len=" + String(len));
  return Buffer.concat([header, payload]);
}

function closeFrame(code: number, reason: string): Buffer {
  const r = Buffer.from(reason, "utf8");
  const p = Buffer.alloc(2 + r.length);
  p.writeUInt16BE(code, 0);
  r.copy(p, 2);
  return serverFrame(0x8, p, true);
}

// A checksum stdout can compare that a truncated payload cannot fake.
function sum8(b: Buffer): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s = (s + (b[i] ?? 0)) & 0xff;
  return s;
}

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  // Unreachable: the conversation is upgrade-only.
  res.writeHead(404);
  res.end();
});

// Connection 1 does the framing matrix and lets the CLIENT close;
// connection 2 is the server-initiated close. `conn` selects.
let conn = 0;
let pinged = false;

server.on("upgrade", (req: http.IncomingMessage, socket, head: Buffer) => {
  conn += 1;
  const which = conn;
  const key = req.headers["sec-websocket-key"] ?? "";
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  console.log("upgrade #" + String(which) + " url=" + String(req.url) +
    " upgrade=" + String(req.headers.upgrade) + " head=" + String(head.length) +
    " version=" + String(req.headers["sec-websocket-version"]));
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  if (which === 2) {
    // The server speaks first and closes first.
    socket.write(serverFrame(0x1, Buffer.from("server-first", "utf8"), true));
    socket.write(closeFrame(1001, "going"));
  }

  let buf: Buffer = Buffer.alloc(0);
  // Fragment reassembly state (a client MAY fragment; the native client
  // does not, but the server must be able to).
  let fragOp = -1;
  let frag: Buffer = Buffer.alloc(0);
  let closing = false;

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
        // The high word must be zero for anything this program can hold.
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

      console.log("in  op=" + String(op) + " fin=" + String(fin) +
        " masked=" + String(masked) + " len=" + String(len) + " sum=" + String(sum8(payload)));

      // RFC 6455 5.1: every client frame MUST be masked. A server that
      // let an unmasked one through would be the bug this line catches.
      if (!masked) {
        socket.write(closeFrame(1002, "unmasked"));
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
        // Echo it back — same opcode, one unmasked frame.
        socket.write(serverFrame(wholeOp, whole, true));
        if (which === 1 && whole.length === 65536 && !pinged) {
          pinged = true;
          socket.write(serverFrame(0x9, Buffer.from("pv", "utf8"), true));
        }
      } else if (op === 0x9) {
        socket.write(serverFrame(0xA, payload, true));
      } else if (op === 0xA) {
        console.log("pong payload=" + payload.toString("utf8"));
      } else if (op === 0x8) {
        const code = len >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = len > 2 ? payload.subarray(2).toString("utf8") : "";
        console.log("close from client code=" + String(code) + " reason=" + reason);
        if (!closing) {
          closing = true;
          socket.write(serverFrame(0x8, payload, true));
        }
        socket.end();
        if (which === 2) server.close();
        return;
      }
    }
  });
  socket.on("error", () => socket.destroy());
});

function dial(port: number, path: string): RawWS {
  const ws = new WS("ws://127.0.0.1:" + String(port) + path);
  ws.binaryType = "arraybuffer";
  return ws;
}

function describe(d: unknown): string {
  if (typeof d === "string") {
    let s = 0;
    for (let i = 0; i < d.length; i++) s = (s + d.charCodeAt(i)) & 0xff;
    return "text len=" + String(d.length) + " sum=" + String(s);
  }
  const u = new Uint8Array(d as ArrayBuffer);
  let s = 0;
  for (let i = 0; i < u.length; i++) s = (s + (u[i] ?? 0)) & 0xff;
  return "bin len=" + String(u.length) + " sum=" + String(s);
}

server.listen(0, "127.0.0.1", async () => {
  const port = (server.address() as { port: number }).port;

  // ── connection 1: the framing matrix ────────────────────────────────
  const ws = dial(port, "/matrix");
  const pending: string[] = [];
  let waiter: ((v: string) => void) | null = null;
  ws.onmessage = (e) => {
    const line = describe(e.data);
    if (waiter !== null) { const w = waiter; waiter = null; w(line); }
    else pending.push(line);
  };
  const next = (): Promise<string> => new Promise<string>((resolve) => {
    const q = pending.shift();
    if (q !== undefined) resolve(q);
    else waiter = resolve;
  });
  await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });
  console.log("client open");

  // Text at every length form boundary, then binary.
  const sizes = [1, 125, 126, 127, 65535, 65536];
  for (const n of sizes) {
    ws.send("a".repeat(n));
    console.log("echo " + String(n) + " -> " + await next());
  }
  ws.send(new Uint8Array(200));
  console.log("echo bin200 -> " + await next());

  // The ping the server sent at the 65536 echo: the native client
  // auto-pongs and the server printed it above. Give it a turn to land.
  await new Promise<void>((r) => { setTimeout(() => { r(); }, 120); });

  // Client-initiated close: the server echoes the frame back.
  await new Promise<void>((resolve) => {
    ws.onclose = (e) => {
      console.log("client close code=" + String(e.code) + " reason=" + String(e.reason) +
        " clean=" + String(e.wasClean));
      resolve();
    };
    ws.close(1000, "done");
  });

  // ── connection 2: the SERVER closes first ───────────────────────────
  // The client's events and the server's view of the echoed close frame
  // are two independent halves of one process, and which turn each lands
  // on is loop scheduling, not protocol: Node runs the server's read
  // ahead of the client's close event and the compiled runtime runs it
  // after. So the client's lines are COLLECTED and printed once both
  // halves have settled — the facts are pinned, the interleave is not.
  const ws2 = dial(port, "/serverclose");
  const c2lines: string[] = [];
  await new Promise<void>((resolve) => {
    ws2.onmessage = (e) => { c2lines.push("c2 " + describe(e.data)); };
    ws2.onclose = (e) => {
      c2lines.push("c2 close code=" + String(e.code) + " reason=" + String(e.reason) +
        " clean=" + String(e.wasClean));
      resolve();
    };
    ws2.onerror = () => { c2lines.push("c2 error"); resolve(); };
  });

  await new Promise<void>((r) => { setTimeout(() => { r(); }, 150); });
  for (const l of c2lines) console.log(l);
  console.log("returned");
});
