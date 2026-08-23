/* What the ORACLE does with `globalThis.WebSocket`'s init bag — measured
 * here, on every gate, against the Node this suite is running under.
 *
 * WHY THIS FILE EXISTS. The compiler's init-bag lowering (ir/nodes.ts's
 * wsInitBagPlan and the two emitters) is built entirely on a claim about
 * somebody else's implementation: that the bag is a WebIDL dictionary with
 * exactly three members, that every other member is ignored, and that
 * "absent" for the one member with no lowering means `undefined` and
 * nothing else. Every one of those was measured once and then written into
 * a comment — and a comment is the spec the code drifts away from. If
 * undici ever starts reading `agent`, the compiler quietly begins dropping
 * a proxy on the floor, and NOTHING else in this repository would notice:
 * the corpus fixtures (6000, 6001) compare scriptc against Node, so they
 * would move together and stay green.
 *
 * So this file does not test scriptc at all. It tests the assumption, and
 * it fails on the day the assumption stops holding.
 *
 * The two halves are deliberately separate:
 *   - what the oracle READS out of the bag, and
 *   - what it DOES with the one member it reads and scriptc cannot honour.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** A hand-rolled upgrade server: it completes the handshake itself, records
 * the request headers verbatim, and sends a close frame. Hand-rolled rather
 * than `ws` because this suite must not depend on an optional package. */
let server: Server;
let url = "";
const seen: string[][] = [];
/* Every upgraded socket, kept so teardown can destroy them. An upgraded
 * connection is no longer the http server's to close: `server.close()` waits
 * for it forever, and the hook times out 300s later with all the assertions
 * already green. */
const upgraded: Socket[] = [];

beforeAll(async () => {
  server = createServer();
  server.on("upgrade", (req, sock: Socket) => {
    upgraded.push(sock);
    sock.on("error", () => {
      /* a client that vanished mid-frame is not a failure here */
    });
    seen.push([...req.rawHeaders]);
    const key = String(req.headers["sec-websocket-key"] ?? "");
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    // Echo the first requested subprotocol. Without it a client that asked
    // for one treats the handshake as failed, and every bag carrying
    // `protocols` below would report an error for a reason that has nothing
    // to do with what is being measured.
    const asked = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")[0]!
      .trim();
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        (asked === "" ? "" : `Sec-WebSocket-Protocol: ${asked}\r\n`) +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
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
  url = `ws://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/probe`;
});

afterAll(async () => {
  for (const s of upgraded) s.destroy();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

interface Dial {
  how: "open" | "error" | "timeout" | "ctor-threw";
  arrived: boolean;
  headers: string[] | null;
}

/** One dial. Resolves on the first of open/error/timeout, and reports
 * whether the request reached the server at all — which is the only way to
 * tell "connected direct" from "handed to something else". */
function dial(arg2: unknown): Promise<Dial> {
  return new Promise<Dial>((resolve) => {
    const before = seen.length;
    const done = (how: Dial["how"]): void =>
      resolve({ how, arrived: seen.length > before, headers: seen[before] ?? null });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, arg2 as string);
    } catch {
      resolve({ how: "ctor-threw", arrived: seen.length > before, headers: null });
      return;
    }
    const timer = setTimeout(() => done("timeout"), 4000);
    ws.onopen = (): void => {
      clearTimeout(timer);
      done("open");
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    };
    ws.onerror = (): void => {
      clearTimeout(timer);
      done("error");
    };
  });
}

/** The upgrade request, with the one header that legitimately varies masked
 * out, so two dials can be compared byte for byte. */
function normalize(h: string[] | null): string | null {
  if (h === null) return null;
  const out: string[] = [];
  for (let i = 0; i < h.length; i += 2) {
    const name = h[i]!;
    out.push(`${name.toLowerCase()}: ${/^sec-websocket-key$/i.test(name) ? "<masked>" : h[i + 1]!}`);
  }
  return out.join("\n");
}

describe("the WebSocket init bag: which members the oracle reads", () => {
  /* The claim wsInitBagPlan is built on. A bag whose every member is a
   * GETTER records exactly which properties the implementation touches, so
   * this is not an inference from behaviour — it is the read set itself. */
  test("exactly protocols, headers and dispatcher — and nothing else", async () => {
    const read: string[] = [];
    const bag = {};
    const members = [
      // the three that are read
      "protocols",
      "headers",
      "dispatcher",
      // the `ws` package's options, which this constructor is not
      "agent",
      "origin",
      "ca",
      "rejectUnauthorized",
      "followRedirects",
      "perMessageDeflate",
      "handshakeTimeout",
      "localAddress",
      "servername",
      "maxPayload",
    ];
    for (const name of members) {
      Object.defineProperty(bag, name, {
        enumerable: true,
        get(): undefined {
          read.push(name);
          return undefined;
        },
      });
    }
    const r = await dial(bag);
    expect(r.how, "the probe bag must dial normally").toBe("open");
    expect([...read].sort(), "the oracle's init-bag read set has changed").toEqual([
      "dispatcher",
      "headers",
      "protocols",
    ]);
  });

  /* The consequence, stated as behaviour rather than as a read set: a LIVE
   * agent changes nothing at all. If this ever fails, the compiler is
   * dropping a proxy in silence and emit-ws.ts must fence `agent` again. */
  test("a live `agent` is ignored — same bytes on the wire, never called", async () => {
    let addRequestCalls = 0;
    const headers = { "x-probe": "constant" };
    const without = await dial({ protocols: ["chat"], headers });
    const withAgent = await dial({
      protocols: ["chat"],
      headers,
      agent: {
        addRequest(): void {
          addRequestCalls += 1;
        },
      },
    });
    expect(without.how, "the control dial").toBe("open");
    expect(withAgent.how, "the dial carrying a live agent").toBe("open");
    expect(withAgent.arrived, "a bag with an `agent` still reaches the origin DIRECT").toBe(true);
    expect(addRequestCalls, "the agent was used — `agent` is no longer ignored").toBe(0);
    expect(
      normalize(withAgent.headers),
      "the upgrade request changed when an `agent` was added to the bag",
    ).toBe(normalize(without.headers));
  });
});

describe("the WebSocket init bag: what `dispatcher` means", () => {
  /* The member the oracle both reads and HONOURS. scriptc cannot, so it
   * refuses — and this is the measurement that says the refusal is right
   * rather than over-strict. */
  test("a live dispatcher takes the whole upgrade; nothing reaches the origin", async () => {
    let dispatchCalls = 0;
    let handlerKeys: string[] = [];
    const r = await dial({
      headers: { "x-probe": "d" },
      dispatcher: {
        dispatch(_opts: unknown, handler: object): boolean {
          dispatchCalls += 1;
          const proto = Object.getPrototypeOf(handler) as object | null;
          handlerKeys = [
            ...new Set([...Object.keys(handler), ...Object.getOwnPropertyNames(proto ?? {})]),
          ].sort();
          return false;
        },
      },
    });
    expect(dispatchCalls, "the oracle did not delegate to the dispatcher").toBe(1);
    expect(r.arrived, "the connection reached the origin despite a dispatcher").toBe(false);
    // The blocker, named: honouring a dispatcher means synthesising THIS
    // object and handing it to program code, sockets and all.
    for (const m of ["onConnect", "onUpgrade", "onError"]) {
      expect(handlerKeys, `the undici handler no longer carries ${m}`).toContain(m);
    }
  });

  /* The distinction the whole fence turns on. Exactly one value means "no
   * dispatcher"; every other one is an error, because the dictionary
   * default fills the slot BEFORE the dispatcher is asserted truthy. A
   * compiler that tested for truthiness instead would dial DIRECT on every
   * row below the first two. */
  test("only `undefined` falls back to a direct dial", async () => {
    const direct: readonly string[] = ["absent", "undefined"];
    const bags: [string, Record<string, unknown>][] = [
      ["absent", {}],
      ["undefined", { dispatcher: undefined }],
      ["null", { dispatcher: null }],
      ["zero", { dispatcher: 0 }],
      ["false", { dispatcher: false }],
      ["empty-string", { dispatcher: "" }],
      ["NaN", { dispatcher: Number.NaN }],
    ];
    for (const [label, extra] of bags) {
      const r = await dial({ headers: { "x-probe": label }, ...extra });
      if (direct.includes(label)) {
        expect(r.how, `dispatcher ${label}: must dial direct`).toBe("open");
        expect(r.arrived, `dispatcher ${label}: must reach the origin`).toBe(true);
      } else {
        // Falsy but not undefined: the oracle THROWS. It must never be
        // read as "no dispatcher" and quietly connected.
        expect(r.how, `dispatcher ${label}: must not dial`).toBe("ctor-threw");
        expect(r.arrived, `dispatcher ${label}: reached the origin — a proxy was ignored`).toBe(
          false,
        );
      }
    }
  });
});
