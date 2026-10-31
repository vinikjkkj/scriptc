/* dns.lookup over the namespace import (portless's form): 'localhost'
 * with { family: 4 } resolves to 127.0.0.1 through /etc/hosts (no
 * external DNS), an .invalid name delivers Node's ENOTFOUND error shape,
 * deliveries stay async (both "queued" lines print first). Both lookups are
 * in flight at once; their completion order is the thread pool's and is not
 * guaranteed (Windows completes them in either order), so each result is
 * held and both print in call order after both have settled. The error-path
 * address argument is deliberately not printed — Node passes undefined where
 * the string slot here holds "" (SEMANTICS.md). */
import * as dns from "node:dns";

const lines: string[] = ["", ""];
let pending = 2;
function settle(slot: number, line: string): void {
  lines[slot] = line;
  pending -= 1;
  if (pending === 0) {
    console.log(lines[0]);
    console.log(lines[1]);
  }
}

dns.lookup("localhost", { family: 4 }, (err, address) => {
  if (err) {
    settle(0, "localhost failed: " + err.message);
    return;
  }
  settle(0, "localhost -> " + address);
});
dns.lookup("host-that-cannot-exist.invalid", { family: 4 }, (err) => {
  if (err) {
    settle(1, "invalid failed: " + err.message);
    return;
  }
  settle(1, "invalid unexpectedly resolved");
});
console.log("queued");
