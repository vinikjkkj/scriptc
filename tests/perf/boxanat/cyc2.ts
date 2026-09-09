// The same cycle, crossed and then ONLY recovered at its static type --
// never read dynamically. A lazily materialised box would never build the
// copy here, so the trap would never fire; today it fires at the crossing.
interface Chain { name: string; next?: Chain; }

const a: Chain = { name: "a" };
a.next = a;

const kept: unknown = a;       // <-- the crossing
const back = kept as Chain;    // the ONLY use: recovery at the static type
console.log("recovered " + back.name + " same=" + String(back === a));
