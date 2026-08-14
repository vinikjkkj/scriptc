// A class that EXTENDS node:events EventEmitter can be projected onto a
// record naming its own members. On `main` it could not: it compiled, and
// then trapped SC2002 at run time under --best-effort.
//
// `ctorWitnessProjection` is what turns a class instance into a record slot —
// method-named fields become closures bound to the instance, data fields ride
// the width-lift copy. Before this change it opened with a walk of the whole
// base chain that declined the class outright if ANY ancestor carried a
// builtin runtime layout:
//
//   for (let c = info; c; c = c.base)
//     if (c.builtinError || c.builtinEmitter || c.builtinStream !== undefined
//         || c.def.runtime) return null;
//
// For %Error that is load-bearing: registerBuiltinErrorClasses publishes
// `name`, `message` and `toString` in the info's fields/methods maps, and
// those are ScrError prefix storage, not plain emitted fields — a projection
// naming one of them would be a lie. For node:events EventEmitter it is not.
// registerBuiltinEmitterClass gives %EventEmitter an EMPTY fields map and an
// EMPTY methods map on purpose: the ScrEmitter registry/name prefix is laid
// out by the BACKEND, so the info carries no IR fields at all. Nothing a plan
// can name ever resolves onto that node. `on`/`emit`/`off` lower through
// lower-emitter.ts and `findMethodOn` cannot see them, so a target naming one
// of THOSE still declines below (no method, no field, no undefined arm) —
// the decline just stops being a decline of the whole class.
//
// This is zapo's shape exactly. `WaClientImpl extends EventEmitter`, and it
// is the reason `estado-pairlid` could not observe its fix from the real
// binary: `client as unknown as { handleIncomingMessageEvent(...) }` compiled
// and then died at the cast, three lines before the call. That report named
// the accessors (`get auth()`, `get message()`, ...) as the cause; they are
// not. An accessor declines only the FIELD IT SATISFIES — see `Accessorful`
// below, which projects fine while carrying two getters.
import { EventEmitter } from "node:events";

class Inner {
    flushed: number = 0;
    flush(): number {
        this.flushed += 1;
        return this.flushed;
    }
}

// The WaClientImpl shape: an emitter subclass with private data, private
// accessors nobody projects, and a private async method the target names.
class Accessorful extends EventEmitter {
    private readonly inner: Inner = new Inner();
    private readonly tag: string = "acc";
    public get one(): number {
        return 1;
    }
    public get two(): string {
        return "2";
    }
    private async handleIncoming(ev: string): Promise<void> {
        console.log("handled", ev, this.tag, this.inner.flush());
    }
}

const acc = new Accessorful();
const drive = acc as unknown as { handleIncoming: (ev: string) => Promise<void> };
await drive.handleIncoming("e1");
await drive.handleIncoming("e2");
console.log("accessors still readable", acc.one, acc.two);

// The bound closure carries the INSTANCE, not a copy of it: a mutation made
// through the class after the projection is visible to the projected method.
class Live extends EventEmitter {
    n: number = 7;
    s: string = "hi";
    private m(x: string): string {
        return x + this.n + this.s;
    }
    bump(): void {
        this.s = this.s + "!";
    }
}

//
// What this does NOT assert, deliberately: the projected DATA field. A data
// field rides the width-lift COPY (SEMANTICS.md 35 — "later mutations of the
// source field don't alias"), so after `live.bump()` the record's `s` still
// reads "hi" here while Node reads "hi!". That divergence is `main`'s, not
// this change's: the identical class with `extends EventEmitter` removed
// prints the identical "hi" on `main` (repro `c7.ts`, measured on the base
// twin). This change makes an emitter subclass behave like every other class,
// including there — it does not introduce the copy. `lp.n` is read only
// BEFORE the mutation for that reason, and `m` is the field that proves the
// closure holds the instance rather than a copy.
const live = new Live();
const lp = live as unknown as { m: (x: string) => string; n: number };
console.log("before", lp.m("A"), lp.n);
live.bump();
console.log("after", lp.m("A"));

// The emitter surface is untouched by the projection — the instance is still
// a working EventEmitter afterwards.
live.on("ping", (v: number) => {
    console.log("ping", v);
});
live.emit("ping", 42);

// Virtual dispatch through the projected closure reaches the OVERRIDE, the
// same as a call through the class.
class VBase extends EventEmitter {
    m(x: string): string {
        return "base:" + x;
    }
}
class VDer extends VBase {
    override m(x: string): string {
        return "der:" + x;
    }
}
const vb: VBase = new VDer();
const vp = vb as unknown as { m: (x: string) => string };
console.log("virtual", vp.m("z"));

// A plain data-field lift off an emitter subclass, and the absent
// optional-flavored field completing to undefined.
class Data extends EventEmitter {
    readonly a: number = 3;
    readonly b: string = "bee";
}
const dp = new Data() as unknown as { a: number; b: string; missing?: string };
console.log("data", dp.a, dp.b, dp.missing === undefined);

// An emitter subclass two levels down still projects: the skip is of the
// builtin node wherever it sits in the chain, not only at the immediate base.
class Mid extends EventEmitter {
    protected readonly k: number = 5;
}
class Leaf extends Mid {
    twice(): number {
        return this.k * 2;
    }
}
const leaf = new Leaf() as unknown as { twice: () => number };
console.log("deep", leaf.twice());

// What still declines, and must: this file asserts only the POSITIVE side of
// the boundary, because a decline is a build error and cannot be observed
// from a running program. The negative controls live in
// tests/diagnostics/emitter-projection-declines.ts — an Error subclass with
// a data field, a target naming an EventEmitter surface method, an
// accessor-satisfied target field, and a signature the method does not have,
// each still refused, and each with byte-identical rendered text on `main`.
