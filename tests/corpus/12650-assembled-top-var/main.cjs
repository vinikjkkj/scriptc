// A top-level `var` initialised from a require member, read inside function bodies (the iconv-lite shape).
var Buffer = require('./lib.cjs').Buffer
function Codec(opts) {
  this.dec = Buffer.from(opts.chars, 'ucs2')
  this.enc = Buffer.alloc(4, 65)
}
var c = new Codec({ chars: 'ab' })
console.log(c.dec.text, c.dec.enc, c.enc.len, c.enc.fill)
function check(x) { return typeof Buffer + ' ' + Buffer.isBuffer(x) }
console.log(check(c.enc), check(3))
var n = [1, 2].map(function (v) { return Buffer.alloc(v).len })
console.log(n.join(','))
