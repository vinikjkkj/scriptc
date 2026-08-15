// The typed-options TLS/HTTPS servers WITH a handler — the lowering rows
// nothing in the corpus reached.
//
// `tls.createServer({ cert, key })` (2330/2331) lowers to tls.createServer;
// adding the second argument lowers to tls.createServerCb instead, and the
// emitters pick the connection adapter by the handler's ARITY. The https
// server picks its request adapter the same way. Those adapter choices were
// written on both backends and no program took them, so a wrong one would
// have compiled, linked and listened exactly like a right one.
//
// Nothing here completes a handshake: each server listens on an ephemeral
// port, reports port > 0 (Node's address() is null before listen — both
// lanes agree only once listening) and closes. That is 2331's shape, and it
// is enough to pin which adapter the emitter chose, because a mismatched
// adapter is a link-time or construction-time failure, not a handshake one.
import { readFileSync } from "node:fs";
import * as tls from "node:tls";
import * as https from "node:https";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");

// tls.createServerCb, connection adapter chosen for a ONE-parameter
// secureConnection handler.
const sock = tls.createServer({ key, cert }, (s) => {
  s.end();
});
sock.listen(0, () => {
  console.log("tls cb sock", sock.address().port > 0);
  sock.close();

  // tls.createServerCb, ZERO-parameter handler — the other adapter.
  const none = tls.createServer({ key, cert }, () => {
    console.log("unreachable: nothing connects");
  });
  none.listen(0, () => {
    console.log("tls cb none", none.address().port > 0);
    none.close();

    // https.createServer, request adapter for arity two…
    const two = https.createServer({ key, cert }, (_req, res) => {
      res.end("two");
    });
    two.listen(0, () => {
      console.log("https two", two.address().port > 0);
      two.close();

      // …arity one…
      const one = https.createServer({ key, cert }, (_req) => {
        console.log("unreachable: nothing requests");
      });
      one.listen(0, () => {
        console.log("https one", one.address().port > 0);
        one.close();

        // …and arity zero.
        const zero = https.createServer({ key, cert }, () => {
          console.log("unreachable: nothing requests");
        });
        zero.listen(0, () => {
          console.log("https zero", zero.address().port > 0);
          zero.close();
          console.log("done");
        });
      });
    });
  });
});
