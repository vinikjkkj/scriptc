/* server.address() under the REAL @types/node declaration.
 *
 * The fallback declares `address(): AddressInfo`, so tests/corpus cannot
 * reach this path at all: the union only exists in the world every real
 * project (and zapo) compiles in. Node v25.9.0, measured across every
 * state before this lowering was written:
 *
 *   created, never listen        null
 *   inside the listen callback   { address, family, port }
 *   after close()                null
 *   a pipe/unix-domain server    the pathname string
 *
 * The string arm is representable and unreachable here -- listen() takes
 * `port[, host]` and the options object, with no path form -- so a
 * compiled server is never a pipe server. The `typeof` test below still
 * has to compile and still has to answer, which is why the arm stays in
 * the union rather than being dropped.
 *
 * Ports are ephemeral, so nothing prints a raw port: the assertions are
 * on the ARM and on the fields whose values are fixed by the bind.
 */
import * as net from "node:net";

const server = net.createServer();

function describe(a: net.AddressInfo | string | null): string {
    if (a === null) return "null";
    if (typeof a === "string") return "string:" + a;
    return "record " + a.address + " " + a.family + " port>0=" + String(a.port > 0);
}

console.log("before listen:", describe(server.address()));

server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    console.log("in listen cb:", describe(a));

    // The discriminating shape -- the one 3604 writes, and the reason the
    // null and string arms have to survive narrowing rather than be
    // asserted away.
    const port = a !== null && typeof a !== "string" ? a.port : -1;
    console.log("narrowed port>0:", port > 0);

    server.close(() => {
        console.log("after close:", describe(server.address()));
        console.log("after close is null:", server.address() === null);
    });
});
