// process.resourceUsage()'s memory and IO rows are filled on every
// supported platform, not only POSIX.
//
// uv_getrusage's Windows arm fills five rows besides the CPU times —
// maxRSS from PeakWorkingSetSize (in kilobytes, uv's own division),
// majorPageFault from PageFaultCount, and fsRead/fsWrite from the process
// IO counters — and Node reports them. This runtime answered 0 for all of
// them there, so `process.resourceUsage().maxRSS > 0` read false where
// Node on the same box reads true.
//
// Every print is a PREDICATE: absolute counter values are machine-, run-
// and platform-dependent, and only their SHAPE is Node-exact. The one
// absolute claim is maxRSS > 0, which holds on every platform Node
// supports — a running process has a peak resident set.
const ru = process.resourceUsage();

// Node's names, in Node's order.
console.log("keys:", Object.keys(ru).join(","));

// The rows this fixture is about.
console.log("maxRSS positive:", ru.maxRSS > 0);
console.log("maxRSS integral:", Number.isFinite(ru.maxRSS) && Math.floor(ru.maxRSS) === ru.maxRSS);
console.log("faults nonneg:", ru.minorPageFault >= 0 && ru.majorPageFault >= 0);
console.log("io nonneg:", ru.fsRead >= 0 && ru.fsWrite >= 0);

// The CPU times, which were always filled.
console.log("cpu nonneg:", ru.userCPUTime >= 0 && ru.systemCPUTime >= 0);

// The rows uv leaves at zero on some platforms stay READABLE numbers
// rather than missing members — the shape is the same everywhere.
console.log(
  "rest finite:",
  Number.isFinite(ru.sharedMemorySize) &&
    Number.isFinite(ru.unsharedDataSize) &&
    Number.isFinite(ru.unsharedStackSize) &&
    Number.isFinite(ru.swappedOut) &&
    Number.isFinite(ru.ipcSent) &&
    Number.isFinite(ru.ipcReceived) &&
    Number.isFinite(ru.signalsCount) &&
    Number.isFinite(ru.voluntaryContextSwitches) &&
    Number.isFinite(ru.involuntaryContextSwitches),
);

// A second read is a fresh sample, still well-shaped (peaks never shrink).
const again = process.resourceUsage();
console.log("resample:", again.maxRSS >= ru.maxRSS, again.userCPUTime >= 0);
