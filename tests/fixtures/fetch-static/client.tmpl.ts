// The fetch differential fixture. Every line it prints is compared
// BYTE-FOR-BYTE between Node v25.9.0 and both compiled backends.
//
// __HTTP__ / __HTTPS__ / __ALT__ are substituted with the fixture
// server's real origins before compiling, because a static build has no
// runtime string it could build a URL literal from.
const HTTP = "__HTTP__"
const HTTPS = "__HTTPS__"
const ALT = "__ALT__"

function say(label: string, value: string): void {
  console.log(label + " " + value)
}

function errText(e: unknown): string {
  const err = e as Error
  return err.name + "/" + err.message
}

async function main(): Promise<void> {
  // 1. a plain 200: status, ok, statusText, redirected, url, body
  {
    const r = await fetch(HTTP + "/ok")
    say("ok.status", String(r.status))
    say("ok.ok", String(r.ok))
    say("ok.statusText", r.statusText)
    say("ok.redirected", String(r.redirected))
    say("ok.url", r.url)
    say("ok.bodyUsed0", String(r.bodyUsed))
    const t = await r.text()
    say("ok.body", t)
    say("ok.len", String(t.length))
    say("ok.bodyUsed1", String(r.bodyUsed))
  }
  // 2. a non-2xx is NOT swallowed: it RESOLVES with ok=false and a body
  {
    const r = await fetch(HTTP + "/404")
    say("e404.ok", String(r.ok))
    say("e404.status", String(r.status))
    say("e404.body", await r.text())
  }
  {
    const r = await fetch(HTTP + "/500")
    say("e500.ok", String(r.ok))
    say("e500.body", await r.text())
  }
  // 3. 204: no body at all
  {
    const r = await fetch(HTTP + "/204")
    say("n204.status", String(r.status))
    say("n204.ok", String(r.ok))
    say("n204.len", String((await r.text()).length))
  }
  // 4. a body that must not be TRUNCATED (content-length, 70000 bytes)
  {
    const r = await fetch(HTTP + "/big")
    const t = await r.text()
    say("big.len", String(t.length))
    say("big.head", t.substring(0, 4))
    say("big.tail", t.substring(t.length - 4))
  }
  // 5. CHUNKED framing, delivered in several writes with a gap
  {
    const r = await fetch(HTTP + "/chunked")
    const t = await r.text()
    say("chunk.body", t)
    say("chunk.len", String(t.length))
  }
  // 6. content-encoding must arrive DECOMPRESSED
  {
    const r = await fetch(HTTP + "/gzip")
    const t = await r.text()
    say("gzip.len", String(t.length))
    say("gzip.head", t.substring(0, 3))
  }
  {
    const r = await fetch(HTTP + "/deflate")
    say("deflate.body", await r.text())
  }
  // 7. REDIRECTS
  {
    const r = await fetch(HTTP + "/redir302")
    say("r302.status", String(r.status))
    say("r302.redirected", String(r.redirected))
    say("r302.url", r.url)
    say("r302.body", await r.text())
  }
  {
    const r = await fetch(HTTP + "/redirrel")
    say("rrel.url", r.url)
    say("rrel.body", await r.text())
  }
  {
    // 301 from a POST rewrites to GET and DROPS the body
    const r = await fetch(HTTP + "/redir301", { method: "POST", body: "payload", headers: { "content-type": "text/plain" } })
    say("r301.body", await r.text())
  }
  {
    // 303 rewrites every non-GET/HEAD to GET
    const r = await fetch(HTTP + "/redir303", { method: "PUT", body: "payload" })
    say("r303.body", await r.text())
  }
  {
    // 307 PRESERVES the method and the body
    const r = await fetch(HTTP + "/redir307", { method: "POST", body: "payload" })
    say("r307.body", await r.text())
  }
  {
    // a 3xx with no Location is a FINAL response carrying its own body
    const r = await fetch(HTTP + "/redirnoloc")
    say("rnoloc.status", String(r.status))
    say("rnoloc.ok", String(r.ok))
    say("rnoloc.redirected", String(r.redirected))
    say("rnoloc.body", await r.text())
  }
  {
    // a redirect LOOP must reject, not spin
    try {
      const r = await fetch(HTTP + "/redirloop")
      say("rloop", "RESOLVED status=" + String(r.status))
    } catch (e) {
      say("rloop", errText(e))
    }
  }
  {
    // a CROSS-ORIGIN hop drops authorization
    const r = await fetch(HTTP + "/redircross", { headers: { authorization: "Bearer s3cret", "x-test": "kept" } })
    say("rcross.body", await r.text())
  }
  // 8. HEADERS: case-insensitive reads, repeats joined, absent is null
  {
    const r = await fetch(HTTP + "/headers")
    say("h.lower", String(r.headers.get("x-mixed-case")))
    say("h.upper", String(r.headers.get("X-MIXED-CASE")))
    say("h.mixed", String(r.headers.get("X-Mixed-Case")))
    say("h.repeat", String(r.headers.get("x-repeat")))
    say("h.absent", String(r.headers.get("x-nothing")))
    say("h.has", String(r.headers.has("Content-Type")))
    say("h.hasnot", String(r.headers.has("x-nothing")))
    await r.text()
  }
  // 9. json()
  {
    const r = await fetch(HTTP + "/json")
    const doc = await r.json() as { a: number[]; b: string }
    say("json.b", doc.b)
    say("json.a0", String(doc.a[0]))
    say("json.a1", String(doc.a[1]))
  }
  {
    try {
      const r = await fetch(HTTP + "/badjson")
      await r.json()
      say("badjson", "RESOLVED")
    } catch (e) {
      say("badjson.name", (e as Error).name)
    }
  }
  // 10. the request the server SEES: method, body, headers
  {
    const r = await fetch(HTTP + "/echo", {
      method: "POST",
      body: "abc",
      headers: { "x-test": "v1", "content-type": "text/plain" },
    })
    say("echo.body", await r.text())
  }
  // 11. a SECOND body read throws synchronously
  {
    const r = await fetch(HTTP + "/ok")
    await r.text()
    try {
      await r.text()
      say("reread", "RESOLVED")
    } catch (e) {
      say("reread.name", (e as Error).name)
    }
  }
  // 12. an ABORT must REJECT, never resolve
  {
    const c = new AbortController()
    setTimeout(() => { c.abort() }, 150)
    try {
      const r = await fetch(HTTP + "/slow", { signal: c.signal })
      say("abort", "RESOLVED status=" + String(r.status))
    } catch (e) {
      say("abort.name", (e as Error).name)
    }
  }
  {
    // an ALREADY-aborted signal rejects before any socket is dialed
    const c = new AbortController()
    c.abort()
    try {
      await fetch(HTTP + "/ok", { signal: c.signal })
      say("pre-abort", "RESOLVED")
    } catch (e) {
      say("pre-abort.name", (e as Error).name)
    }
  }
  // 13. a TLS failure must THROW, never answer a Response
  {
    try {
      const r = await fetch(HTTPS + "/ok")
      say("tls", "RESOLVED status=" + String(r.status))
    } catch (e) {
      say("tls.name", (e as Error).name)
      say("tls.msg", (e as Error).message)
    }
  }
  // 14. a refused connection and an unresolvable name both REJECT
  {
    try {
      await fetch("http://127.0.0.1:1/x")
      say("refused", "RESOLVED")
    } catch (e) {
      say("refused.name", (e as Error).name)
      say("refused.msg", (e as Error).message)
    }
  }
  {
    try {
      await fetch("http://no-such-host.invalid./x")
      say("dns", "RESOLVED")
    } catch (e) {
      say("dns.name", (e as Error).name)
      say("dns.msg", (e as Error).message)
    }
  }
  // 15. a bad URL and an unsupported scheme reject rather than throw
  {
    try {
      await fetch("::not a url::")
      say("badurl", "RESOLVED")
    } catch (e) {
      say("badurl.name", (e as Error).name)
    }
  }
  say("ALT", ALT.length > 0 ? "set" : "unset")
  say("END", "done")
}
void main()
