// IPv6 hosts in a static URL: bracketed hosts parse (zero-run compression, mixed IPv4, ports), serialize canonically, keep their brackets in host/hostname/origin, and bad ones throw; the host and hostname setters take them too.
const inputs = ["http://[::1]:3000/", "http://[::1]/", "https://[2001:db8::1]:8443/a?b#c", "http://[2001:0DB8:0000:0000:0000:0000:0000:0001]/", "http://[1:0:0:2:0:0:0:3]/", "http://[::]/", "http://[1::]/", "http://[::ffff:192.168.0.1]/", "http://[1:2:3:4:5:6:7:8]:80/", "ws://[fe80::1%25eth0]/", "http://[1:2:3:4:5:6:7:8:9]/", "http://[::1/", "http://[::1]x/", "http://[:1]/", "http://[1::2::3]/", "ftp://u:p@[::1]:21/z", "http://[0:0:1:0:0:0:0:1]/", "foo://[::1]:5/x", "http://[::1]:99999/", "http://[::1.2.3]/", "http://[1:2:3:4:5:6:1.2.3.4]/"];
for (const s of inputs) {
  try { const u = new URL(s); console.log(s, "->", u.href, u.host, u.hostname, u.port, u.origin, u.pathname); } catch (e: any) { console.log(s, "ERR", e.message); }
}
const u = new URL("http://example.com/p");
u.hostname = "[2001:db8::2]"; console.log(u.href);
u.host = "[::1]:8080"; console.log(u.href, u.host, u.port);
u.hostname = "[bad"; console.log(u.href);
console.log(new URL("/x", "http://[::1]:1/").href, new URL("http://[::1]:3000").hostname);
