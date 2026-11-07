// Runtime probe: many instances of package classes (pgpool's Client, an EventEmitter-rooted class) created and dropped, plus a method call each.
import { Client } from "pgpool";
let connected = 0;
const t0 = Date.now();
for (let round = 0; round < 40; round++) {
  const live = [new Client({ n: -1 })];
  for (let i = 0; i < 50000; i++) {
    const c = new Client({ n: i });
    c.connected = i % 2 === 0;
    if (c.connected) connected++;
    live.push(c);
  }
  live.length = 0;
}
console.log(connected);
console.error("ms", Date.now() - t0);
