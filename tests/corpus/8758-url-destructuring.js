const u = new URL('http://user:pw@example.com:8080/p/a?q=1&r=2#frag');
const { hostname, port, pathname } = u;
console.log(hostname, port, pathname);
const { protocol, host: h2, search, hash, username: un, password, href } = u;
console.log(protocol, h2, search, hash, un, password, href);
const { searchParams } = u;
console.log(searchParams.get('r'), searchParams.toString());
function parse(s) { const { hostname, port, pathname: p = '/' } = new URL(s); return [hostname, port, p]; }
console.log(parse('https://a.example/x'), parse('ftp://b:21'));
