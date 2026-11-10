// Node 24 evaluates a type-stripped TypeScript module a second time, into a separate instance, when it is imported under a json attribute; the
// compiled program has one set of module globals, so the build refuses instead of answering the wrong instance.
export {};
const m = await import("./mod.ts", { with: { type: "json" } });
console.log(m);
