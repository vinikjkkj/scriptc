// URL origin (tuple origin, blob: inner origin, opaque "null") and toJSON().
const urls = ['https://user:pw@Example.com:8080/a/b?x=1#f', 'http://h.com:80/', 'https://h.com:443/p', 'ws://w.org:81', 'ftp://f.net/x',
  'file:///tmp/x', 'mailto:a@b.c', 'data:text/plain,hi', 'blob:https://b.org/uuid-1', 'blob:null/xyz', 'git://g.com/r', 'foo://bar/baz'];
for (const s of urls) {
  const u = new URL(s);
  console.log(u.origin, u.toJSON());
}
const u = new URL('http://a.com:9/p');
u.port = '80'; console.log(u.origin);
u.host = 'zz.org:5'; console.log(u.origin);
