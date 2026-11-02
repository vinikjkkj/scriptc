// The one-argument optional call through a rest-pack closure. On the base this
// COMPILED and printed the wrong thing (the string where the pack array belongs:
// `arrow 3 string false`), so it is a silent divergence, not a refusal.
type Logger = (...messages: unknown[]) => void;
const f: Logger = (...m: unknown[]) => {
  console.log("arrow", m.length, typeof m, Array.isArray(m), String(m[0]));
};
const l2: Logger | undefined = f;
l2?.("opt");
l2?.(42);
const none: Logger | undefined = undefined as Logger | undefined;
none?.("skipped");
