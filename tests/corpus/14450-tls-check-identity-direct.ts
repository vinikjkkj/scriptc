import * as Tls from "tls";
function show(label: string, host: string, cert: any): void {
  const e = Tls.checkServerIdentity(host, cert);
  if (e === undefined) { console.log(label, "ok"); return; }
  const x = e as any;
  console.log(label, e instanceof Error, e.name, x.code, e.message, x.reason, x.host, typeof x.cert);
}
show("exact", "example.com", { subject: { CN: "example.com" } });
show("cn-mismatch", "example.com", { subject: { CN: "other.com" } });
show("san-match", "example.com", { subject: { CN: "x" }, subjectaltname: "DNS:example.com" });
show("san-miss", "example.com", { subject: { CN: "example.com" }, subjectaltname: "DNS:a.com, DNS:b.com" });
show("wild-ok", "a.foo.com", { subjectaltname: "DNS:*.foo.com" });
show("wild-apex", "foo.com", { subjectaltname: "DNS:*.foo.com" });
show("wild-deep", "a.b.foo.com", { subjectaltname: "DNS:*.foo.com" });
show("wild-tld", "a.com", { subjectaltname: "DNS:*.com" });
show("trailing-dot", "example.com.", { subjectaltname: "DNS:example.com" });
show("case", "ExAmple.COM", { subjectaltname: "DNS:example.com" });
show("ip4-san", "10.0.0.1", { subjectaltname: "IP Address:10.0.0.1" });
show("ip4-miss", "10.0.0.2", { subjectaltname: "IP Address:10.0.0.1, DNS:x.com" });
show("ip6-canon", "2001:db8::1", { subjectaltname: "IP Address:2001:DB8:0:0:0:0:0:1" });
show("no-names", "example.com", {});
show("cn-array", "example.com", { subject: { CN: ["x.com", "example.com"] } });
show("quoted-san", "foo.com", { subjectaltname: 'DNS:"a,b", DNS:foo.com' });
show("quoted-miss", "foo.com", { subjectaltname: 'DNS:"a,b", DNS:bar.com' });
show("empty-cn", "example.com", { subject: { CN: "" } });
