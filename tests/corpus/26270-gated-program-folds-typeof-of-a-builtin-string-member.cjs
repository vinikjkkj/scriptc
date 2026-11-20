// pg/lib/stream.js shape: typeof navigator.userAgent === 'string' is statically true, so the code after the early return is dead and
// `new MessageChannel` (no scriptc lowering) is never lowered. A program that can hold an absent regex capture must keep that fold.
function isCloudflareRuntime() {
  if (typeof navigator === 'object' && navigator !== null && typeof navigator.userAgent === 'string') {
    return navigator.userAgent === 'Cloudflare-Workers'
  }
  if (typeof MessageChannel === 'function') {
    const resp = new MessageChannel()
    if (typeof resp.port1 === 'object') {
      return true
    }
  }
  return false
}
const m = new RegExp(process.argv[2] ?? '(a)|(b)').exec('b')
console.log(m[2], typeof m[1], isCloudflareRuntime())
