// `C?.m()` — the STATIC METHOD call through an optional link, and the
// asymmetry it closes. 3601 made `C?.x` lower; `C?.bump()` still fenced
// with "method calls like 'C?.bump'", because lowerStaticMethodCall opened
// with a raw `if (access.questionDotToken) return null;` and declined the
// optional-chain machinery's own re-dispatch — the same receiver, the same
// class, one spelling working and the other not.
//
// A static method call is a sharper test than a static field read, because
// it OBSERVES: the method mutates a static field, so a guard that stopped
// short-circuiting would not answer a wrong value, it would run a wrong
// EFFECT. Every absent arm below is checked for both — the answer is
// undefined, and the counter did not move.

class Counter {
    static hits = 0;
    static bump(): number {
        Counter.hits = Counter.hits + 1;
        return Counter.hits;
    }
    static add(n: number): number {
        Counter.hits = Counter.hits + n;
        return Counter.hits;
    }
    static label(): string {
        return "counter:" + Counter.hits;
    }
}

class Derived extends Counter {
    static extra(): number {
        return Counter.hits * 10;
    }
}

// ── the identifier receiver: never nullish, `?.` is `.` ────────────────
console.log("bump:", Counter?.bump(), "hits:", Counter.hits);
console.log("add:", Counter?.add(5), "hits:", Counter.hits);
console.log("label:", Counter?.label());
console.log("inherited:", Derived?.bump(), "own:", Derived?.extra());
console.log("agrees:", Counter?.label() === Counter.label());

// ── argument evaluation, exactly once and in order ─────────────────────
let evals: string[] = [];
function arg(tag: string, v: number): number {
    evals.push(tag);
    return v;
}
function shown(): string {
    const s = evals.join(",");
    evals = [];
    return s === "" ? "(none)" : s;
}
console.log("arg once:", Counter?.add(arg("a", 2)), shown(), "hits:", Counter.hits);

// ── the classval BINDING, both arms ────────────────────────────────
// A CALL receiver (`pick(true)?.bump()`) keeps its own fence on both
// sides: lowerStaticMethodCall admits an identifier receiver only, exactly
// as the PLAIN spelling does, so nothing about the optional link is what
// refuses there. The binding is the shape this block moves.
function pick(on: boolean): typeof Counter | undefined {
    return on ? Counter : undefined;
}

const live = pick(true);
const gone = pick(false);

const before = Counter.hits;
console.log("present:", live?.bump());
console.log("moved by one:", Counter.hits === before + 1);

// THE proof the guard survived: the absent arm answers undefined, the
// ARGUMENT is not evaluated at all, and the static field does not move.
const held = Counter.hits;
console.log("absent:", gone?.add(arg("skip", 100)));
console.log("args:", shown(), "hits unchanged:", Counter.hits === held);
console.log("absent is undefined:", gone?.bump() === undefined);
console.log("still unchanged:", Counter.hits === held);

console.log("live again:", live?.bump(), "gone again:", gone?.bump());
console.log("gone is undefined:", gone?.bump() === undefined, "hits:", Counter.hits);
console.log("coalesced:", gone?.add(arg("no", 7)) ?? -1, shown());
console.log("live coalesced:", live?.add(arg("yes", 7)) ?? -1, shown());
console.log("live label:", live?.label(), "gone label:", gone?.label());

// ── the property side 3601 already had, beside the call side ───────────
console.log("field:", Counter?.hits, "name:", Counter?.name);
console.log("both spellings:", Counter?.hits === Counter.hits);
console.log("bound field:", live?.hits, "gone field:", gone?.hits);
