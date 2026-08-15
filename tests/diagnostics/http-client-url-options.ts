// The fences `request(url, options[, callback])` keeps, each naming its
// reason. The positive half — every shape that DOES lower — is
// tests/corpus/3761-http-client-url-with-options.ts and
// tests/fixtures/server/cases/https-request-url-options.
//
// Node builds the request options as `ObjectAssign(urlToHttpOptions(url),
// options)`, so an option that names a URL part REPLACES it. The URL row
// derives host/port/path from the parse itself and has no second source
// of truth, so those four keys fence rather than half-merge. Everything
// else the two-argument options form still spells.
import * as http from "node:http";
import * as https from "node:https";
import { connect } from "node:net";
import type { IncomingMessage } from "node:http";

const cb = (res: IncomingMessage) => { console.log(res.statusCode); };
const url = "http://127.0.0.1:9/";

// The four keys Node merges OVER the URL's own parts.
http.request(url, { host: "elsewhere" }, cb);
http.request(url, { hostname: "elsewhere" }, cb);
http.request(url, { port: 1234 }, cb);
http.request(url, { path: "/somewhere-else" }, cb);
https.get("https://127.0.0.1:9/", { path: "/x" }, cb);

// An options record in the middle slot with a NON-URL first argument is
// not a Node form at all: there the second argument becomes the callback
// and the third is dropped.
http.request({ hostname: "127.0.0.1", port: 9, path: "/" }, { method: "GET" }, cb);
http.request({ path: "/" }, { method: "GET" });

// An Agent VALUE alongside a URL now LOWERS (the requestUrlAgent rows —
// tests/corpus/3792-http-client-optional-options.ts). What still fences
// is an agent the dial cannot be handed to: the caller's own dialer owns
// the socket, and a request-function binding picks its module at runtime.
const agent = new http.Agent({});
http.request(url, { agent, createConnection: () => connect(9) }, cb);

// The caller's own dialer owns the socket; a URL to dial contradicts it.
const dialer = () => connect(9);
http.request(url, { createConnection: dialer }, cb);

// A request-function binding picks its dial at RUNTIME, and the two
// schemes reject each other's URLs — the same reason the two-argument
// URL row has no binding mode.
function through(tls = false): void {
  const requestFn = tls ? https.request : http.request;
  requestFn(url, { method: "HEAD" }, cb);
}
through();
