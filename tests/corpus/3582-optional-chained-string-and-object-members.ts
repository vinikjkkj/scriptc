// The two receiver-typed lowerings whose receivers are ordinary VALUES
// rather than handles: `s?.lastIndexOf(n)` on a string, and `o?.toString()`
// resolving to Object.prototype.toString on a record / program-class
// receiver. Both opened with a raw `questionDotToken` test and declined the
// optional-chain machinery's own re-dispatch.
//
// The class arm is the one worth pinning: the default toString FOLDS to the
// constant "[object Object]", and a fold is exactly where a receiver's
// effects can go missing. Under a chain the receiver has already been
// evaluated by the chain (that is what proved it non-nullish), so the fold
// must not evaluate it a second time — and must not skip it either.

function pickStr(on: boolean): string | undefined {
    return on ? "abcabc" : undefined;
}

let needleEvals = 0;
function needle(): string {
    needleEvals = needleEvals + 1;
    return "b";
}

console.log("present:", String(pickStr(true)?.lastIndexOf(needle())));
console.log("needle evals:", needleEvals);
console.log("absent:", String(pickStr(false)?.lastIndexOf(needle())));
console.log("needle evals (unchanged):", needleEvals);
console.log("absent is undefined:", pickStr(false)?.lastIndexOf("b") === undefined);

// Not-found is -1, not undefined — the two must not be confused when the
// result rides an undefined-armed union.
console.log("missing needle:", String(pickStr(true)?.lastIndexOf("z")));
console.log("empty needle:", String(pickStr(true)?.lastIndexOf("")));

// ── the default toString ───────────────────────────────────────────────
class Box {
    n: number;
    constructor(n: number) {
        this.n = n;
    }
}

let boxEvals = 0;
function pickBox(on: boolean): Box | undefined {
    boxEvals = boxEvals + 1;
    return on ? new Box(7) : undefined;
}

console.log("class present:", String(pickBox(true)?.toString()));
console.log("class absent:", String(pickBox(false)?.toString()));
console.log("box evals:", boxEvals);

type Rec = { x: number; y: string };
function pickRec(on: boolean): Rec | undefined {
    return on ? { x: 1, y: "two" } : undefined;
}
console.log("record present:", String(pickRec(true)?.toString()));
console.log("record absent:", String(pickRec(false)?.toString()));

// The chained value is a real string, not a stand-in: it concatenates and
// compares like one.
const s = pickBox(true)?.toString();
console.log("concat:", "<" + String(s) + ">", s === "[object Object]");

// ── the class-constructor own-property fold, chained ───────────────────
// `A?.hasOwnProperty(lit)` on a PROGRAM class: the receiver is never
// nullish, so the chain takes its never-nullish path — it marks the node
// handled and re-dispatches without an optChain wrapper at all. The raw
// guard declined that re-dispatch too, and the site fell to the member
// fence naming `typeof A.hasOwnProperty`.
class WithStatics {
    static readonly tag: string = "t";
    static make(): number {
        return 1;
    }
}
console.log("own static field:", WithStatics?.hasOwnProperty("tag"));
console.log("own static method:", WithStatics?.hasOwnProperty("make"));
console.log("function trio:", WithStatics?.hasOwnProperty("prototype"), WithStatics?.hasOwnProperty("name"));
console.log("absent key:", WithStatics?.hasOwnProperty("nope"));
