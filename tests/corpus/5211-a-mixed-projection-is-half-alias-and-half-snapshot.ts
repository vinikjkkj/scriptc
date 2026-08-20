// A class instance projected into an interface that mixes a METHOD and a
// DATA field is half alias and half snapshot, and SC6003 now says so.
//
// The method-named target field becomes a closure bound to the LIVE
// instance — a call through the projection is a call on the object, which
// is what makes tests/corpus/2685's shared state right. The data field
// rides the width-lift COPY taken at the projection, the documented width
// stance (docs limitations: "mutations through the narrower reference are
// invisible to the original"). Each half is defensible alone. Together they
// give one reference two identities.
//
// WHAT THIS FILE DOES NOT ASSERT, deliberately, because Node is the oracle
// and scriptc does not match here:
//
//     interface View { n: number; bump(): void }
//     class C { n = 0; bump(): void { this.n++; } }
//     function through(v: View): string { v.bump(); return String(v.n); }
//     through(new C())        node "1"        scriptc "0"
//
// The compiler cannot answer that correctly with the record model: a data
// field is storage at a fixed offset in a monomorphic struct, and making it
// alias would need the TARGET SHAPE to carry an accessor slot, which is
// exactly what makes a shape neither JSON-safe nor dyn-convertible. So it
// says what it is about to do instead — one SC6003 advisory per projection,
// naming the class and the copied fields a method writes — and the
// advisory's own admission rule is asserted in
// packages/compiler/test/projection-mixed-advice.test.ts.
//
// What IS asserted below is every neighbouring behaviour, because a fix or a
// fence in this area has to keep all of it:
//   * the method half really does reach the live instance;
//   * the ORIGINAL sees the writes those calls make;
//   * a data field read BEFORE any call through the projection is right;
//   * a mixed shape whose copied field no method writes is right throughout;
//   * a methods-only projection shares state completely;
//   * a data-only projection is the documented copy.

// ---- the method half aliases: the ORIGINAL sees the write --------------
interface Counter {
    seen: number;
    bump(): void;
    read(): number;
}

class CounterImpl implements Counter {
    public seen = 0;
    public bump(): void {
        this.seen += 1;
    }
    public read(): number {
        return this.seen;
    }
}

const live = new CounterImpl();
function driveCounter(c: Counter): string {
    const before = c.seen; // the copy, read before any call: right
    c.bump();
    c.bump();
    // read() is a closure on the LIVE instance, so it reports the writes
    return "before=" + String(before) + " viaMethod=" + String(c.read());
}
console.log(driveCounter(live));
// and the original, under its own name, sees them too
console.log("original=" + String(live.seen));
console.log("original via method=" + String(live.read()));

// ---- a mixed shape nothing mutates is right throughout -----------------
interface Labelled {
    label: string;
    describe(): string;
}

class LabelledImpl implements Labelled {
    public readonly label: string;
    private calls = 0;
    public constructor(label: string) {
        this.label = label;
    }
    public describe(): string {
        this.calls += 1;
        return this.label + "#" + String(this.calls);
    }
}

function driveLabelled(l: Labelled): string {
    const a = l.describe();
    const b = l.describe();
    // `label` is copied, but nothing writes it, so the copy can never go
    // stale: every read agrees with Node.
    return l.label + " " + a + " " + b + " " + l.label;
}
console.log(driveLabelled(new LabelledImpl("x")));

// A constructor write is not a mutation of a live value: it runs before the
// projection exists, so this shape is silent for SC6003 too.
const named = new LabelledImpl("y");
console.log(driveLabelled(named));
console.log("named label=" + named.label);

// ---- methods-only: state is shared completely --------------------------
interface Store {
    load(): number;
    save(v: number): void;
}

class StoreImpl implements Store {
    private v = 0;
    public load(): number {
        return this.v;
    }
    public save(v: number): void {
        this.v = v;
    }
}

function driveStore(s: Store): string {
    s.save(41);
    const a = s.load();
    s.save(a + 1);
    return "store=" + String(s.load());
}
const st = new StoreImpl();
console.log(driveStore(st));
console.log("store original=" + String(st.load()));

// ---- data-only: the documented copy ------------------------------------
interface Pt {
    x: number;
    y: number;
}

class PtImpl implements Pt {
    public x = 1;
    public y = 2;
}

function drivePt(p: Pt): string {
    return "pt=" + String(p.x) + "," + String(p.y);
}
const pt = new PtImpl();
console.log(drivePt(pt));
console.log("pt original=" + String(pt.x) + "," + String(pt.y));

// ---- the projection is a value, and behaves like one --------------------
// Two projections of the same instance are two records; the methods on both
// still reach the one object, so the counts continue rather than restart.
const shared = new CounterImpl();
function bumpOnce(c: Counter): number {
    c.bump();
    return c.read();
}
console.log("shared1=" + String(bumpOnce(shared)));
console.log("shared2=" + String(bumpOnce(shared)));
console.log("shared3=" + String(bumpOnce(shared)));
console.log("shared original=" + String(shared.seen));
