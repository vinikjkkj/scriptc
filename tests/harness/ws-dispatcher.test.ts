/* What the ORACLE demands of a `dispatcher`, and what scriptc builds for
 * one — measured here, on every gate, against the Node this suite runs
 * under.
 *
 * WHY THIS FILE EXISTS. `packages/runtime/src/scr_ws_dispatch.c` builds
 * undici's request-options record and undici's ten-member handler out of
 * nothing: every key, every key ORDER, every arity and every header name
 * in it is a claim about somebody else's implementation. Those were
 * measured once and would otherwise live in a comment, which is the spec
 * the code drifts away from. If undici starts reading a member this unit
 * does not provide, or stops providing one this unit sends, a compiled
 * program hands its proxy a request the proxy cannot use — and the corpus
 * fixtures would not notice, because they compare scriptc against Node and
 * both sides move together.
 *
 * So the first half tests the ASSUMPTION, with a real hand-written
 * dispatcher that carries an upgrade end to end. It fails on the day the
 * assumption stops holding.
 *
 * The second half tests scriptc: that a bag whose `dispatcher` this
 * compiler can call carries NO refusal in the emitted translation unit and
 * DOES carry the delegation, on both lanes — and that the one deliberate
 * divergence (no `sec-websocket-extensions`) is still exactly one.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import net from "node:net";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

let server: Server;
let url = "";
let originPort = 0;
/** Every upgraded socket, so teardown can destroy them: an upgraded
 * connection is no longer the http server's to close and `server.close()`
 * waits for it forever. */
const upgraded: Socket[] = [];
/** How many upgrade requests reached the ORIGIN. The only way to tell
 * "connected direct" from "handed to the dispatcher". */
let arrived = 0;

beforeAll(async () => {
  server = createServer();
  server.on("upgrade", (req, sock: Socket) => {
    arrived++;
    upgraded.push(sock);
    sock.on("error", () => {
      /* a client that vanished mid-frame is not a failure here */
    });
    const key = String(req.headers["sec-websocket-key"] ?? "");
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    setTimeout(() => {
      const payload = Buffer.from("hi");
      sock.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    }, 5);
    setTimeout(() => {
      try {
        sock.end(Buffer.from([0x88, 0x00]));
      } catch {
        /* the client may already be gone */
      }
    }, 20);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  originPort = typeof addr === "object" && addr !== null ? addr.port : 0;
  url = `ws://127.0.0.1:${originPort}/probe?q=1`;
});

afterAll(async () => {
  for (const s of upgraded) s.destroy();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

interface Seen {
  opts: Record<string, unknown> | null;
  handlerKeys: string[];
  handlerKinds: Record<string, string>;
  events: string[];
  socketReads: string[];
  socketCalls: string[];
}

/** One delegated dial with a dispatcher that really carries the upgrade:
 * it opens its own TCP connection, writes the request built from `opts`,
 * parses the 101 and hands the socket back. Records everything the
 * implementation touches on the way. */
function delegated(): Promise<Seen> {
  return new Promise<Seen>((resolve) => {
    const seen: Seen = {
      opts: null,
      handlerKeys: [],
      handlerKinds: {},
      events: [],
      socketReads: [],
      socketCalls: [],
    };
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve(seen);
    };
    const dispatcher = {
      dispatch(opts: Record<string, unknown>, handler: Record<string, unknown>): boolean {
        seen.opts = opts;
        seen.handlerKeys = Object.getOwnPropertyNames(handler);
        for (const k of seen.handlerKeys) {
          const v = handler[k];
          seen.handlerKinds[k] =
            typeof v === "function" ? `function/${(v as (...a: unknown[]) => unknown).length}` : String(v);
        }
        const sock = net.connect(originPort, "127.0.0.1", () => {
          const hdrs = opts["headers"] as Record<string, string>;
          let head = `GET ${String(opts["path"])} HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\n`;
          for (const [k, v] of Object.entries(hdrs)) head += `${k}: ${v}\r\n`;
          // Upgrade/Connection are NOT in opts.headers: `opts.upgrade` is
          // what tells the dispatcher to send them. Measured, and it cost a
          // probe that never reached the origin.
          head += `Connection: upgrade\r\nUpgrade: ${String(opts["upgrade"])}\r\n\r\n`;
          sock.write(head);
        });
        let buf = Buffer.alloc(0);
        let up = false;
        sock.on("data", (d: Buffer) => {
          if (up) return;
          buf = Buffer.concat([buf, d]);
          const i = buf.indexOf("\r\n\r\n");
          if (i < 0) return;
          up = true;
          const lines = buf.subarray(0, i).toString("latin1").split("\r\n");
          const rest = buf.subarray(i + 4);
          const status = Number(lines[0]!.split(" ")[1]);
          const arr: Buffer[] = [];
          for (const l of lines.slice(1)) {
            const c = l.indexOf(":");
            if (c > 0) {
              arr.push(Buffer.from(l.slice(0, c)), Buffer.from(l.slice(c + 1).trim()));
            }
          }
          // A recording proxy over the socket: what the implementation
          // READS off it and CALLS on it is the other half of the contract.
          const spy = new Proxy(sock, {
            get(t, p, r) {
              if (typeof p === "string") seen.socketReads.push(p);
              const v = Reflect.get(t, p, r) as unknown;
              if (typeof v === "function") {
                return function (...args: unknown[]): unknown {
                  seen.socketCalls.push(
                    p === "on" ? `on(${JSON.stringify(args[0])})` : String(p),
                  );
                  return (v as (...a: unknown[]) => unknown).apply(t, args);
                };
              }
              return v;
            },
          });
          (handler["onUpgrade"] as (s: number, h: Buffer[], k: unknown) => void)(status, arr, spy);
          if (rest.length > 0) sock.unshift(rest);
        });
        sock.on("error", () => {
          (handler["onError"] as (e: unknown) => void)(new Error("proxy socket error"));
        });
        return true;
      },
    };
    const ws = new WebSocket(url, { dispatcher } as unknown as string);
    ws.onopen = (): void => {
      seen.events.push("open");
      // SENDING is what reaches the cork/write/uncork group below; without
      // it the socket surface this asserts is only half exercised.
      ws.send("ping");
    };
    ws.onmessage = (e): void => {
      seen.events.push(`message:${String(e.data)}`);
    };
    ws.onerror = (): void => {
      seen.events.push("error");
    };
    ws.onclose = (e): void => {
      seen.events.push(`close:${e.code}`);
      done();
    };
    setTimeout(done, 5000);
  });
}

let seen: Seen;
beforeAll(async () => {
  seen = await delegated();
}, 30_000);

describe("what a WebSocket dispatcher is handed, and what it must give back", () => {
  test("the delegated upgrade really works, and the origin is reached ONLY through it", () => {
    expect(seen.events, "the delegated dial did not complete").toEqual([
      "open",
      "message:hi",
      "close:1005",
    ]);
    // One request reached the origin: the dispatcher's own. The
    // implementation never dialled beside it.
    expect(arrived, "the origin saw a request the dispatcher did not make").toBe(1);
  });

  test("`opts` is undici's request-options record, in undici's key order", () => {
    expect(seen.opts).not.toBeNull();
    expect(Object.keys(seen.opts!)).toEqual([
      "path",
      "origin",
      "method",
      "body",
      "headers",
      "maxRedirections",
      "upgrade",
    ]);
    expect(seen.opts!["path"], "path is pathname+search").toBe("/probe?q=1");
    expect(seen.opts!["origin"], "a ws: URL's origin is http:").toBe(
      `http://127.0.0.1:${originPort}`,
    );
    expect(seen.opts!["method"]).toBe("GET");
    expect(seen.opts!["body"]).toBeNull();
    expect(seen.opts!["maxRedirections"]).toBe(0);
    expect(seen.opts!["upgrade"], "the Upgrade/Connection headers are NOT in opts.headers").toBe(
      "websocket",
    );
  });

  test("the request headers, and the ONE scriptc deliberately withholds", () => {
    const names = Object.keys(seen.opts!["headers"] as Record<string, string>);
    expect(names).toEqual([
      "sec-websocket-key",
      "sec-websocket-version",
      "sec-websocket-extensions",
      "accept",
      "accept-language",
      "sec-fetch-mode",
      "user-agent",
      "pragma",
      "cache-control",
      "accept-encoding",
    ]);
    // THE DIVERGENCE, asserted from the oracle's side so it can never
    // become "we forgot": scr_ws_dispatch.c sends every one of these
    // EXCEPT sec-websocket-extensions, because scr_websocket.c has no
    // inflate and a server that accepted permessage-deflate would send
    // frames the parser would read as garbage. If undici ever stops
    // offering it, this row changes and the divergence is over.
    expect(
      (seen.opts!["headers"] as Record<string, string>)["sec-websocket-extensions"],
    ).toBe("permessage-deflate; client_max_window_bits");
  });

  test("the handler is ten members, in undici's order, with undici's arities", () => {
    expect(seen.handlerKeys).toEqual([
      "body",
      "abort",
      "onConnect",
      "onResponseStarted",
      "onHeaders",
      "onData",
      "onComplete",
      "onError",
      "onRequestUpgrade",
      "onUpgrade",
    ]);
    // `body` and `abort` are null VALUES rather than functions -- undici
    // fills `abort` in from the argument it passes to onConnect.
    expect(seen.handlerKinds).toEqual({
      body: "null",
      abort: "null",
      onConnect: "function/1",
      onResponseStarted: "function/0",
      onHeaders: "function/4",
      onData: "function/1",
      onComplete: "function/0",
      onError: "function/1",
      onRequestUpgrade: "function/4",
      onUpgrade: "function/3",
    });
  });

  test("what the implementation demands of the socket it is given back", () => {
    // These are the reads and calls scr_ws_dispatch.c's ScrNetSocket must
    // answer. `session` is TLS info and undefined is accepted; the three
    // listeners and the cork/write/uncork group are the whole surface.
    expect(new Set(seen.socketCalls.map((c) => c.replace(/\(.*/, "")))).toEqual(
      new Set(["on", "cork", "write", "uncork"]),
    );
    const listened = seen.socketCalls.filter((c) => c.startsWith("on("));
    expect(listened).toEqual(['on("data")', 'on("close")', 'on("error")']);
    expect(seen.socketReads).toContain("session");
  });
});

/* ── the scriptc side ─────────────────────────────────────────────────
 * A bag whose `dispatcher` this compiler can call must carry NO refusal
 * and MUST carry the delegation, on BOTH lanes. The second half is not
 * redundant: with `dispatcher` out of the refusal list and no arm on the
 * LLVM tier, that lane emitted neither, and dialled DIRECT -- a proxy
 * silently ignored, which is the failure this whole item exists to
 * prevent. It passed every other test in the tree. */
const DELEGATABLE = [
  "interface WaProxyDispatcher { dispatch(...args: readonly unknown[]): unknown }",
  "interface RawWsEvent { readonly code?: number; readonly data?: unknown }",
  "interface RawWebSocket {",
  "  binaryType: string",
  "  readyState: number",
  "  onopen: ((ev: RawWsEvent) => void) | undefined",
  "  onmessage: ((ev: RawWsEvent) => void) | undefined",
  "  onclose: ((ev: RawWsEvent) => void) | undefined",
  "  onerror: ((ev: RawWsEvent) => void) | undefined",
  "  send: (data: string) => void",
  "  close: (code?: number, reason?: string) => void",
  "}",
  "interface WaRawWebSocketInit {",
  "  readonly protocols?: string | readonly string[]",
  "  readonly headers?: Readonly<Record<string, string>>",
  "  readonly dispatcher?: WaProxyDispatcher",
  "}",
  "type RawWebSocketConstructor = new (",
  "  url: string,",
  "  protocols?: string | readonly string[] | WaRawWebSocketInit,",
  ") => RawWebSocket",
  "declare const wsUrl: string",
  "declare const wsDispatcher: WaProxyDispatcher | undefined",
  "export function dial(): RawWebSocket {",
  "  const ctor = (globalThis as typeof globalThis & { WebSocket?: RawWebSocketConstructor })",
  "    .WebSocket",
  "  if (!ctor) { throw new Error('no global WebSocket') }",
  "  return new ctor(wsUrl, { protocols: ['a'], dispatcher: wsDispatcher })",
  "}",
  "console.log(typeof dial)",
  "",
].join("\n");

/** The same bag with a `dispatcher` this compiler CANNOT call -- a
 * checked-dynamic slot, which carries no proof it even has a `dispatch`.
 * Declining is the loud direction and this pins that it still declines. */
const UNLOWERABLE = DELEGATABLE.replace(
  "readonly dispatcher?: WaProxyDispatcher",
  "readonly dispatcher?: unknown",
).replace("declare const wsDispatcher: WaProxyDispatcher | undefined", "declare const wsDispatcher: unknown");

const LANES = ["c", "llvm"] as const;
const TU = new Map<string, string>();

beforeAll(async () => {
  const lab = await mkdtemp(join(tmpdir(), "scriptc-ws-dispatcher-"));
  for (const [name, src] of [
    ["delegatable", DELEGATABLE],
    ["unlowerable", UNLOWERABLE],
  ] as const) {
    for (const backend of LANES) {
      const dir = join(lab, `${name}-${backend}`);
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${name}.ts`);
      await writeFile(file, src, "utf8");
      const res = await compile(file, {
        outPath: join(dir, "program"),
        outDir: dir,
        backend,
        bestEffort: true,
      });
      if (!res.ok) {
        throw new Error(`${name}/${backend} did not build: ${res.diagnostics[0]?.code ?? "?"}`);
      }
      TU.set(`${name}:${backend}`, readFileSync(res.cPath, "utf8"));
    }
  }
}, 600_000);

describe("what the compiler emits for a bag that carries a dispatcher", () => {
  test.for(LANES)("a delegatable dispatcher: no refusal, and the delegation is there (%s)", (backend) => {
    const tu = TU.get(`delegatable:${backend}`)!;
    expect(tu, `${backend}: the refusal is still in the translation unit`).not.toContain(
      "carries 'dispatcher'",
    );
    expect(tu, `${backend}: no SC2020 of any kind should survive here`).not.toContain("SC2020");
    expect(
      tu,
      `${backend}: NO delegation call -- this lane would dial direct and ignore the proxy`,
    ).toContain("scr_ws_disp_global_new");
  });

  test.for(LANES)("an unlowerable dispatcher still refuses, and tags (%s)", (backend) => {
    const tu = TU.get(`unlowerable:${backend}`)!;
    expect(tu, `${backend}: a dyn dispatcher must keep its refusal`).toContain(
      "carries 'dispatcher'",
    );
    expect(tu, `${backend}: the refusal must stay tagged`).toContain("SC2020");
    expect(
      tu,
      `${backend}: an unlowerable dispatcher must NOT reach the delegation`,
    ).not.toContain("scr_ws_disp_global_new");
  });
});
