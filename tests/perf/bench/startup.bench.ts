// Startup latency: the smallest program that still proves it ran.
// Timed EXTERNALLY by the driver (spawn -> exit) with Node's
// high-resolution clock, because the compiled runtime's own
// performance.now() is quantised to ~15.6 ms and cannot see this.
import { benchEnd } from "./_bench.ts"
console.log("SCBENCH-STARTUP ok")
benchEnd()
