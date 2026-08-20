// A WebSocket that COMPLETES its closing handshake and is then dropped —
// the shape of every real transport, which nulls its socket field in the
// close event — must leave nothing behind: main returns, the loop finds
// no work, the process exits.
//
// It did not. The transport stopped READING at the close and left the fd
// OPEN. While the program still holds the WebSocket object that is
// invisible, because the native reader is still attached: the peer's FIN
// arrives, scr_net_sock_eof runs, and the fd closes on its own. Drop the
// object at the close event and the record is freed, the socket loses its
// only consumer, consumer-driven read arming disarms the read — and the
// FIN that would have closed the fd is never observed. The fd sits in
// CLOSE_WAIT forever, the socket never leaves the net registry, and the
// loop's liveness test answers "net is pending" for the rest of time.
// Measured on a real client: two sockets in CLOSE_WAIT twelve minutes
// after the last byte, on a program whose main() had returned.
//
// The server here is hand-rolled on node:net for one reason: the FIN has
// to arrive AFTER the drop, deterministically, and no library lets a test
// say when it sends one. Everything printed is order-independent — the
// fixture's assertion is that it TERMINATES, which stdout cannot show and
// a timeout can.
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
// Long enough that the drop below always wins, short enough to stay cheap.
const FIN_DELAY_MS = 150;

function acceptFor(key: string): string {
    return createHash("sha1").update(key + GUID).digest("base64");
}

// The smallest server that can complete a handshake and a close: the 101
// with the computed accept, then one unmasked close frame (1000) in reply
// to the client's, then the TCP FIN on a timer.
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
    sock.on("error", () => { /* the FIN race is the point; errors are not */ });
});

// The only reference the program keeps. Nulled at the close event.
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
    held = null;
    // Outlive the server's FIN, so the fd this fixture is about is the
    // ONLY thing that could still be holding the loop when main returns.
    await new Promise<void>((r) => {
        setTimeout(() => { r(); }, FIN_DELAY_MS * 3);
    });
    console.log("returned");
});
