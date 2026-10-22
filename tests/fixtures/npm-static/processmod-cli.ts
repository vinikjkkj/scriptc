// npm-static pilot: require('process') is the global process: typeof/in probes on its members and hrtime
import pk from "processmod";
console.log(pk.clock(), pk.probe());
