// A GENERIC signature held in a record field: the member keeps a real
// closure slot, mapped at its CONSTRAINT instantiation (the one
// instantiation a generic value can honestly wear), and calls through the
// record read that slot. The emitter idiom is the motivating shape.
type Payloads = { ready: { at: number }; failed: { why: string } };

const seen: string[] = [];

function emit<K extends keyof Payloads>(event: K, payload: Payloads[K]): void {
  seen.push(event + ":" + JSON.stringify(payload));
}

const bag: { fire: <K extends keyof Payloads>(event: K, payload: Payloads[K]) => void } = {
  fire: emit,
};

bag.fire("ready", { at: 9 });
bag.fire("failed", { why: "no" });

console.log(seen.join("|"), seen.length);

// The same signature pinned into a plain const slot.
const direct: <K extends keyof Payloads>(event: K, payload: Payloads[K]) => void = emit;
direct("ready", { at: 1 });
console.log(seen.length);
