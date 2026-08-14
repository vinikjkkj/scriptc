// The NEGATIVE side of "an EventEmitter subclass projects onto a record of
// its own members" (tests/corpus/3631-...). Each cast below must still be
// refused, and each is refused for a different reason.
//
// 1. An Error subclass. registerBuiltinErrorClasses publishes `name`,
//    `message` and `toString` in %Error's fields/methods maps and those are
//    ScrError prefix storage, not plain emitted fields — so the whole-chain
//    decline stays for the error hierarchy. Only the node:events emitter node
//    is skipped, and only because its fields and methods maps are EMPTY.
//
// 2. A target naming an EventEmitter SURFACE method. `on` lowers through
//    lower-emitter.ts and never enters %EventEmitter's (empty) methods map,
//    so `findMethodOn` cannot see it, `info.fields` has no such field, and
//    the field type has no undefined arm to complete to. The projection
//    declines the plan — which is the point: relaxing the class-level guard
//    must not let a member of the builtin surface project as a lie.
//
// 3. An accessor-satisfied target field on an emitter subclass. A getter is
//    not a single projectable value, and this decline is per-FIELD and always
//    was: `estado-pairlid` read it as a per-CLASS decline and concluded that
//    WaClientImpl was unprojectable because it carries `get auth()`. It is
//    not — 3631 projects a class with two getters. This is the case that
//    really does decline.
//
// 4. A method whose signature is not the field's. `(unknown) => string` is
//    not `(string) => string`: the slot would accept a number the method
//    cannot take. Unrelated to the emitter chain, and included because it is
//    the OTHER half of what closed estado-pairlid's last route — its harness
//    typed the event parameter `unknown`.
//
// 5. A BARE EventEmitter. The skip applies only to the builtin as a STRICT
//    ancestor (`c !== info`); the runtime class itself is still refused, and
//    the whole emitter surface with it.
import { EventEmitter } from "node:events";

class MyErr extends Error {
    readonly code2: number = 3;
    m(x: string): string {
        return x;
    }
}
const e = new MyErr("boom") as unknown as { m: (x: string) => string; code2: number };
console.log(e.m("a"), e.code2);

class Surface extends EventEmitter {
    private readonly n: number = 1;
    private m(x: string): string {
        return x + this.n;
    }
}
const s = new Surface() as unknown as { on: (ev: string, f: () => void) => unknown };
console.log(typeof s.on);

class Getter extends EventEmitter {
    private readonly n: number = 7;
    public get val(): number {
        return this.n;
    }
}
const g = new Getter() as unknown as { val: number };
console.log(g.val);

class Sig extends EventEmitter {
    private m(x: string): string {
        return x;
    }
}
const w = new Sig() as unknown as { m: (x: unknown) => string };
console.log(w.m("a"));

const bare = new EventEmitter() as unknown as { setMaxListeners: (n: number) => unknown };
console.log(typeof bare.setMaxListeners);
