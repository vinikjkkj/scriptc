// 5240's opposite control. Same server, same handshake, same close — the
// one difference is that the program KEEPS its reference to the closed
// WebSocket. That kept the socket's native reader attached, so the peer's
// FIN was observed and the fd closed on its own, which is exactly why the
// defect 5240 pins could sit in the tree unseen: the WebSocket surface's
// own fixtures all hold their socket.
//
// It must terminate before AND after the fix, so a green 5240 next to a
// green 5241 says the discriminator is the DROP and not "WebSocket".
import { createHash } from "node:crypto";
import * as net from "node:net";

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
const FIN_DELAY_MS = 150;

function acceptFor(key: string): string {
    return createHash("sha1").update(key + GUID).digest("base64");
}

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
                if (i > 0 && line.slice(0, i).toLowerCase() === "sec-websocket-key") {
                    key = line.slice(i + 1).trim();
                }
            }
            upgraded = true;
            sock.write(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + acceptFor(key) + "\r\n\r\n"
            );
            return;
        }
        const first = chunk[0];
        const opcode = first === undefined ? 0 : first & 0x0f;
        if (opcode === 8) {
            sock.write(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
            setTimeout(() => {
                sock.destroy();
                server.close();
            }, FIN_DELAY_MS);
        }
    });
    sock.on("error", () => { /* see 5240 */ });
});

let held: RawWS | null = null;

server.listen(0, "127.0.0.1", async () => {
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => {
        const ws = new WS("ws://127.0.0.1:" + String(port) + "/");
        ws.binaryType = "arraybuffer";
        held = ws;
        ws.onopen = () => {
            if (held !== null) held.close(1000, "bye");
        };
        ws.onclose = (e) => {
            console.log("close code=" + String(e.code) + " wasClean=" + String(e.wasClean));
            resolve();
        };
        ws.onerror = () => {
            console.log("ws error");
            resolve();
        };
    });
    await new Promise<void>((r) => {
        setTimeout(() => { r(); }, FIN_DELAY_MS * 3);
    });
    // The reference is still live here, and readyState is terminal.
    console.log("held readyState=" + String(held === null ? -1 : held.readyState));
    console.log("returned");
});
