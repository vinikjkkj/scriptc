// The other two request-adapter arities of https.createServerDynCb, over a
// TYPED-RECORD options binding (the runtime-walk lowering, not the literal
// one). A zero-parameter and a one-parameter handler each pick their own
// adapter in the emitter; nothing connects, so the handlers never run and
// only the construction and the listening port are observed. Each server
// listens on an ephemeral port and closes.
import { readFileSync } from "node:fs";
import * as https from "node:https";

type TlsOpts = { key: string; cert: string };
const opts: TlsOpts = {
  key: readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8"),
  cert: readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8"),
};

const zero = https.createServer(opts, () => {
  console.log("unreachable: nothing requests");
});
zero.listen(0, () => {
  console.log("zero", zero.address()!.port > 0);
  zero.close();
  const one = https.createServer(opts, (_req) => {
    console.log("unreachable: nothing requests");
  });
  one.listen(0, () => {
    console.log("one", one.address()!.port > 0);
    one.close();
  });
});
