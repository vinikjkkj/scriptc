// `f?.(args)` on a closure whose compiled slot is a rest PACK: the surplus
// arguments pack into one array exactly as a direct call packs them. Before the
// repair the optional-call form handed the FIRST argument to the pack slot as
// itself, so `m.length` read the string's length and `Array.isArray(m)` was
// false -- a silent divergence from Node.
type Logger = (...messages: unknown[]) => void;

const seen: string[] = [];
const record: Logger = (...m: unknown[]) => {
  seen.push(m.length + "/" + typeof m + "/" + Array.isArray(m) + "/" + m.map((x) => String(x)).join("|"));
};
const maybe: Logger | undefined = record;
const absent: Logger | undefined = undefined as Logger | undefined;

maybe?.("opt");
maybe?.("a", "b");
maybe?.();
maybe?.(1, true, null);
absent?.("never", "called");
if (maybe) maybe("direct");
record("plain", 2);

interface Holder {
  log?: Logger;
}
const h: Holder = { log: record };
const none: Holder = {};
h.log?.("field", "optional");
none.log?.("skipped");
let calls = 0;
function bump(): string {
  calls++;
  return "arg" + calls;
}
none.log?.(bump());
h.log?.(bump(), bump());
console.log(calls);

for (const line of seen) console.log(line);
