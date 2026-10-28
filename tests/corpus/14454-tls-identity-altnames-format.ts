import * as Tls from "tls";
try {
  Tls.checkServerIdentity("a.com", { subjectaltname: 'DNS:"abc, DNS:a.com' } as any);
  console.log("no throw");
} catch {
  console.log("threw");
}
console.log(Tls.checkServerIdentity("a.com", { subjectaltname: 'DNS:"a\\u0062c", DNS:a.com' } as any) === undefined);
