// The silent-wrong-answer hunt for the widen-only lib change.
//
// lib.dom.d.ts REDECLARES globals @types/node also declares: URL, URLSearchParams,
// TextEncoder, TextDecoder, AbortController, AbortSignal. When DOM joins the
// program those names may resolve to DOM's declaration instead of node's -- and
// if scriptc routes a lowering off the declaration's identity, the SAME SOURCE
// could lower differently with DOM present.
//
// Every line prints a REAL VALUE that a wrong implementation gets wrong.
// `typeof` would answer "object" for both the right and the wrong answer and
// could not tell them apart, so `typeof` appears nowhere here.
// Members restricted to scriptc's supported URL surface so BOTH lanes build --
// a lane that refuses cannot be compared for a wrong answer.
const u = new URL('https://user:pw@example.co.uk:8443/a/b?q=1&r=2#frag')
console.log('protocol = ' + u.protocol)
console.log('hostname = ' + u.hostname)
console.log('host     = ' + u.host)
console.log('pathname = ' + u.pathname)
console.log('search   = ' + u.search)
console.log('href     = ' + u.href)
console.log('toString = ' + u.toString())

const sp = new URLSearchParams('a=1&b=two&a=3')
console.log('sp.get(a) = ' + sp.get('a'))
console.log('sp string = ' + sp.toString())

const enc = new TextEncoder()
const bytes = enc.encode('h\u00e9llo \u20ac')
let hex = ''
for (let i = 0; i < bytes.length; i += 1) {
    const t = bytes[i].toString(16)
    hex += t.length === 1 ? '0' + t : t
}
console.log('utf8 hex = ' + hex)
console.log('utf8 len = ' + bytes.length)

const dec = new TextDecoder()
console.log('decoded  = ' + dec.decode(bytes))

const ac = new AbortController()
console.log('aborted before = ' + ac.signal.aborted)
ac.abort()
console.log('aborted after  = ' + ac.signal.aborted)
