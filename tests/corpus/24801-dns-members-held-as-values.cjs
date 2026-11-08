"use strict";
// ioredis's cluster options hold the dns members as DEFAULT VALUES: `resolveSrv: dns_1.resolveSrv, dnsLookup: dns_1.lookup`, called later
// through the stored values. Every spelling of a member is the same function, and a call through the stored value runs the same native entry.
const dns_1 = require("dns");
const { resolveSrv, lookup, setServers, getServers } = require("node:dns");
const DEFAULTS = { useSRVRecords: false, resolveSrv: dns_1.resolveSrv, dnsLookup: dns_1.lookup, setServers: dns_1.setServers, getServers: dns_1.getServers };
console.log(typeof DEFAULTS.resolveSrv, typeof DEFAULTS.dnsLookup, typeof DEFAULTS.setServers, typeof DEFAULTS.getServers);
console.log(DEFAULTS.resolveSrv === resolveSrv, DEFAULTS.dnsLookup === lookup, DEFAULTS.setServers === setServers, DEFAULTS.getServers === getServers);
const asAny = (f) => /** @type {any} */ (f);
console.log(asAny(DEFAULTS.resolveSrv).name, asAny(DEFAULTS.resolveSrv).length, asAny(DEFAULTS.dnsLookup).name, asAny(DEFAULTS.dnsLookup).length, asAny(DEFAULTS.setServers).length, asAny(DEFAULTS.getServers).length);
const oldGetServers = DEFAULTS.getServers;
const oldResolveSrv = DEFAULTS.resolveSrv;
const systemServers = oldGetServers().length;
DEFAULTS.setServers(["1.1.1.1", "8.8.8.8:5353", "[2001:db8::1]:5353", "2001:db8::2"]);
// setServers replaces the DEFAULT resolver: members read afterwards are bound to the new one, members captured before stay on the old
console.log(JSON.stringify(dns_1.getServers()), oldGetServers().length === systemServers, oldGetServers === dns_1.getServers, oldResolveSrv === dns_1.resolveSrv);
console.log(dns_1.getServers === dns_1.getServers, dns_1.resolveSrv === dns_1.resolveSrv, dns_1.lookup === lookup, dns_1.setServers === setServers);
// the invalid-argument calls go through an `any` view: the declared types would refuse them at build time
try { asAny(DEFAULTS.setServers)(["not an ip"]); } catch (e) { console.log(e.name, e.code, e.message); }
try { asAny(DEFAULTS.setServers)("1.1.1.1"); } catch (e) { console.log(e.name, e.code, e.message); }
try { asAny(DEFAULTS.setServers)([5]); } catch (e) { console.log(e.name, e.code, e.message); }
try { asAny(DEFAULTS.resolveSrv)(5, () => {}); } catch (e) { console.log(e.name, e.code, e.message); }
try { asAny(DEFAULTS.resolveSrv)("a.example.com", "x"); } catch (e) { console.log(e.name, e.code, e.message); }
console.log(JSON.stringify(dns_1.getServers()));
DEFAULTS.dnsLookup("127.0.0.1", (err, address, family) => {
  console.log("literal v4", err, address, family);
  DEFAULTS.dnsLookup("::1", (err2, address2, family2) => {
    console.log("literal v6", err2, address2, family2);
    DEFAULTS.dnsLookup("127.0.0.1", { all: true }, (err3, list) => {
      console.log("all literal", err3, JSON.stringify(list));
      DEFAULTS.dnsLookup("localhost", { family: 4 }, (err4, address4, family4) => {
        console.log("localhost v4", err4, address4, family4);
        DEFAULTS.dnsLookup("no-such-host.invalid", (err5, address5) => {
          console.log("invalid", err5 && err5.code, err5 && err5.syscall, err5 && err5.hostname, address5);
        });
      });
    });
  });
});
