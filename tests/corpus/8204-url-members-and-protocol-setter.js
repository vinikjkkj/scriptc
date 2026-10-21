// URL members ws reads (hash, port, username, password) and the protocol
// setter it uses to turn an http(s) address into ws(s).
const a = new URL('http://user:p%40ss@example.com:8080/a/b?q=1#frag');
console.log(a.hash, a.port, a.username, a.password);
console.log(a.protocol, a.host);

const b = new URL('https://example.com/x');
console.log(JSON.stringify([b.hash, b.port, b.username, b.password]));

const c = new URL('http://example.com:80/path');
c.protocol = 'ws:';
console.log(c.href, c.port === '');

const d = new URL('https://example.com/secure');
d.protocol = 'wss:';
console.log(d.href, d.protocol);

// a special scheme cannot become a non-special one, and a bad scheme is ignored
const e = new URL('http://example.com/keep');
e.protocol = 'foo:';
console.log(e.href);
e.protocol = '1x:';
console.log(e.href);
e.protocol = 'https';
console.log(e.href);

const f = new URL('http://example.com:8080/p');
f.protocol = 'https:';
console.log(f.href, f.port);
