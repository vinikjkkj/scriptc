// The two diagnostics_channel PROPERTY lowerings — `ch?.name`,
// `ch?.hasSubscribers`, and the TracingChannel event channels — wore the
// `access.questionDotToken` spelling of the same raw guard, so they
// declined the optional-chain re-dispatch exactly like the `expr` ones.
//
// These were the pair the previous block named as the next to take: a
// Channel is an f64 HANDLE with nothing in its IR type to discriminate it,
// so the lowerings gate on a provenance predicate — and that predicate was
// already taught to ask the lowerer's own typeOf (which consults the
// chain's narrow) rather than the checker directly. With that half already
// in place, only the guard was missing.
//
// hasSubscribers is the interesting member: it is the publish guard, so an
// absent receiver answering `false` instead of `undefined` would read as
// "nobody is listening" and quietly suppress a publish. The nullish arm is
// pinned for both channel kinds.

import { channel, tracingChannel, subscribe } from "node:diagnostics_channel";

const ch = channel("scriptc:probe:3605");

let recvEvals = 0;
function pick(on: boolean): typeof ch | undefined {
    recvEvals = recvEvals + 1;
    return on ? ch : undefined;
}

console.log("name:", pick(true)?.name);
console.log("agrees with plain:", pick(true)?.name === ch.name);
console.log("subscribers before:", pick(true)?.hasSubscribers);

subscribe("scriptc:probe:3605", () => {});

console.log("subscribers after:", pick(true)?.hasSubscribers);
console.log("agrees with plain:", pick(true)?.hasSubscribers === ch.hasSubscribers);

// The nullish arm: undefined, not the empty-channel `false`.
console.log("absent name:", pick(false)?.name);
console.log("absent subscribers:", pick(false)?.hasSubscribers);
console.log("absent is undefined:", pick(false)?.hasSubscribers === undefined);
console.log("not false:", pick(false)?.hasSubscribers !== false);
console.log("receiver evals:", recvEvals);

// A binding rather than a call receiver, so the handle is read through the
// chain's bound value.
const held = pick(true);
console.log("held name:", held?.name, "held subs:", held?.hasSubscribers);

// ── TracingChannel ─────────────────────────────────────────────────────
const tc = tracingChannel("scriptc:trace:3605");

function pickT(on: boolean): typeof tc | undefined {
    return on ? tc : undefined;
}

console.log("tc subscribers:", pickT(true)?.hasSubscribers);
console.log("tc absent:", pickT(false)?.hasSubscribers);

// The five event channels are Channel-typed handles of their own, so the
// tail reads one member through another — the chain claims the whole tail
// and both steps lower inside the single guard.
console.log("tc start name:", pickT(true)?.start.name);
console.log("tc end name:", pickT(true)?.end.name);
console.log("tc error name:", pickT(true)?.error.name);
console.log("tc absent start:", pickT(false)?.start.name);
console.log("tc agrees with plain:", pickT(true)?.start.name === tc.start.name);
