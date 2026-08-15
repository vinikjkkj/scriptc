// Node's THREE-argument client spelling, `request(url, options[,
// callback])` — the form a from-scratch client reaches for once it wants
// a method or headers on a URL it already has as a string. The URL keeps
// supplying host/port/path (same WHATWG parse, same module-checked
// scheme, query kept and fragment dropped); the middle argument supplies
// method, timeout and headers. `request(url, options)` with no callback
// is the same form minus the once('response') registration, and get() is
// request() plus the eager end().
//
// The option keys Node would merge OVER a URL part (host/hostname/port/
// path), an Agent VALUE and a createConnection dialer fence at the call
// instead — pinned in tests/diagnostics/http-client-url-options.ts.
//
// Everything here dials 127.0.0.1, so the test needs no network. The
// ephemeral port never prints: only what the server READ off the wire.
import * as http from "node:http";
import * as https from "node:https";

const server = http.createServer((req, res) => {
  const keys = Object.keys(req.headers).sort();
  let out = `${req.method} ${req.url}`;
  for (const k of keys) {
    // The Host header carries the ephemeral port — its PRESENCE is the
    // observable, not its value.
    out += k === "host" ? " | host=<authority>" : ` | ${k}=${req.headers[k]}`;
  }
  res.end(out);
});

server.listen(0, () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  let n = 0;
  const show = (tag: string, res: http.IncomingMessage) => {
    let b = "";
    res.on("data", (c) => { b += c; });
    res.on("end", () => {
      console.log(tag, res.statusCode, b);
      step();
    });
  };
  const step = () => {
    n++;
    if (n === 1) {
      // method + headers over a URL string; the query survives the parse
      // and the fragment does not. POST with no body is Node's
      // content-length: 0.
      const r = http.request(`${base}/a?q=1#frag`, { method: "POST", headers: { "x-a": "1" } }, (res) => show("post", res));
      r.end();
    } else if (n === 2) {
      // get() is the same row with the eager end()
      http.get(`${base}/b`, { headers: { "x-b": "2" } }, (res) => show("get", res));
    } else if (n === 3) {
      // no callback: the response arrives through on('response')
      const r = http.request(`${base}/c`, { method: "PUT" });
      r.on("response", (res) => show("noCb", res));
      r.end();
    } else if (n === 4) {
      // a URL OBJECT reads as its href through the same parse
      const u = new URL(`${base}/d?z=9`);
      const r = http.request(u, { method: "DELETE", headers: { "x-n": "7" } }, (res) => show("urlobj", res));
      r.end();
    } else if (n === 5) {
      // agent: false is Node's one-shot dial — Connection: close
      const r = http.request(`${base}/e`, { method: "GET", agent: false }, (res) => show("agentfalse", res));
      r.end();
    } else if (n === 6) {
      // a numeric header value is String(n), and an empty options record
      // is exactly the two-argument URL form
      const r = http.request(`${base}/f`, { headers: { "x-num": 42 } }, (res) => show("numhdr", res));
      r.end();
    } else if (n === 7) {
      const r = http.request(`${base}/g`, {}, (res) => show("emptyopts", res));
      r.end();
    } else if (n === 8) {
      // a body still writes through the returned request
      const r = http.request(`${base}/h`, { method: "POST", headers: { "content-type": "text/plain" } }, (res) => show("body", res));
      r.end("hello");
    } else {
      // The scheme is the calling MODULE's, not the URL's, and an
      // unparsable input is the WHATWG TypeError — both catchable, both
      // through the three-argument form.
      try {
        http.get("https://127.0.0.1/nope", { method: "GET" }, () => {});
      } catch (e) {
        console.log("scheme", (e as Error).message);
      }
      try {
        http.get("not a url", { method: "GET" }, () => {});
      } catch (e) {
        console.log("parse", (e as Error).message);
      }
      // The TLS twin of the row, exercised on the legs that never dial:
      // the scheme check and the parse are the same shared code, and the
      // https extras (rejectUnauthorized, ca) ride the same call.
      try {
        https.request("http://127.0.0.1/nope", { method: "GET", rejectUnauthorized: false }, () => {});
      } catch (e) {
        console.log("tls scheme", (e as Error).message);
      }
      try {
        https.request("also not a url", { method: "HEAD", ca: "" });
      } catch (e) {
        console.log("tls parse", (e as Error).message);
      }
      server.close();
    }
  };
  step();
});
