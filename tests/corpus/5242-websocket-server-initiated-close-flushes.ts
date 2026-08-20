// The SERVER initiates the close. 5240 pins that the socket is given
// back; this one pins that giving it back does not TRUNCATE the reply.
//
// A server-initiated close is answered from inside the very callback that
// finishes the connection, so the client's own close frame is still in the
// socket's write buffer at the moment the transport lets go. A teardown
// that closed the fd there would drop it and the peer would see a
// truncated stream instead of a clean handshake; the flush-then-FIN
// spelling is what keeps "the server saw the client's close frame" true.
// Both facts print, and the program must terminate.
import { createHash } from "node:crypto";
import * as net from "node:net";

interface WSEventLike { readonly code?: number; readonly reason?: string; readonly wasClean?: boolean; readonly data?: unknown }
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

function acceptFor(key: string): string { return createHash("sha1").update(key + GUID).digest("base64"); }

let sawReply = false;

const server = net.createServer((sock) => {
  let head = "";
  let upgraded = false;
  sock.on("data", (chunk: Buffer) => {
    if (!upgraded) {
      head += chunk.toString("latin1");
      if (head.indexOf("\r\n\r\n") < 0) return;
      let key = "";
      for (const line of head.split("\r\n")) {
        const i = line.indexOf(":");
        if (i > 0 && line.slice(0, i).toLowerCase() === "sec-websocket-key") key = line.slice(i + 1).trim();
      }
      upgraded = true;
      sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acceptFor(key) + "\r\n\r\n");
      // The server closes FIRST, right after the handshake.
      sock.write(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
      return;
    }
    const first = chunk[0];
    const opcode = first === undefined ? 0 : first & 0x0f;
    if (opcode === 8) {
      sawReply = true;
      setTimeout(() => { sock.destroy(); server.close(); }, 150);
    }
  });
  sock.on("error", () => {});
});

let held: RawWS | null = null;
server.listen(0, "127.0.0.1", async () => {
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => {
    const ws = new WS("ws://127.0.0.1:" + String(port) + "/");
    ws.binaryType = "arraybuffer";
    held = ws;
    ws.onopen = () => { console.log("open"); };
    ws.onclose = (e) => { console.log("close code=" + String(e.code) + " wasClean=" + String(e.wasClean)); resolve(); };
    ws.onerror = () => { console.log("ws error"); resolve(); };
  });
  held = null;
  await new Promise<void>((r) => { setTimeout(() => { r(); }, 450); });
  console.log("server saw the client's close frame:", sawReply);
  console.log("returned");
});
