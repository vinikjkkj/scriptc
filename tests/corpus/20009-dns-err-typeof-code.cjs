// Corpus 20009: dns.lookup error member read unguarded; only the type of code is printed (resolver text varies).
const dns = require('dns');
dns.lookup('nonexistent.invalid', (err, addr) => { console.log(typeof err.code, typeof err.message); });
