// A generic member reached through an interface PROPERTY whose type is an
// indexed access into a GENERIC interface -- the shape every plugin host in
// @zapo-js has, and the shape whose closure slot the compiler used to throw
// away.
//
// The slot rule already existed: a record member whose call signature maps
// at its type parameters' CONSTRAINT instantiation keeps an ordinary
// closure field, and any producer fills it. What decided the constraint was
// the type NODE written after `extends` -- and a type node resolves in the
// scope it was WRITTEN in. For a member of a generic interface that scope
// still holds the interface's own parameters open, so
//
//     interface Client<TPluginEvents = {}> {
//         on<K extends keyof (EventMap & TPluginEvents)>(...): void
//     }
//     interface Ctx { readonly on: Client['on'] }
//
// answered `keyof EventMap | keyof TPluginEvents` -- an index type over an
// abstract parameter, which maps to nothing. The member left the shape, and
// every call of it through a `Ctx`-typed parameter refused with "calls of
// the generic method 'on' with no defining object literal", naming a
// constraint the program never wrote. The SIGNATURE is instantiated (the
// checker substituted `TPluginEvents := {}` in its parameters and its
// return type); only the constraint was being read out of context.
//
// The declaration still answers WHETHER a constraint was written -- that
// question the checker cannot answer, because it reports undefined both for
// "no constraint" and for a parameter carrying only a default, and the
// learned-arms path depends on telling those apart.
//
// WHAT THIS PROGRAM PROVES BEYOND COMPILING. Generic members dispatch
// statically when they monomorphize, so a closure slot filled by the WRONG
// producer would call the wrong body with no diagnostic. Six distinct
// bodies reach the one call site here -- four factory closures each capturing
// a different tag, one shared literal, and a receiver chosen at run time --
// and every one of them must print its own line in its own order.
//
// PINNED IN TIER_REGRESSIONS (tests/harness/llvm-differential.test.ts): a
// revert does not FAIL this program, it stops compiling it, and a refused
// program is scored as a skip.

interface EvA {
    readonly x: number
}
interface EvB {
    readonly y: string
}
interface EventMap {
    a: (e: EvA) => void
    b: (e: EvB) => void
}

/** The generic host. `TPluginEvents` is exactly why the constraint could
 * not be read off its declaration: inside this interface it is abstract. */
interface Client<TPluginEvents = {}> {
    on<K extends keyof (EventMap & TPluginEvents)>(
        event: K,
        listener: (EventMap & TPluginEvents)[K]
    ): void
    off<K extends keyof (EventMap & TPluginEvents)>(
        event: K,
        listener: (EventMap & TPluginEvents)[K]
    ): void
}

/** The consumer surface: PROPERTIES (not method signatures) typed by an
 * indexed access into the generic interface above, which is how a plugin
 * context republishes its host's typed emitter. */
interface Ctx {
    readonly on: Client['on']
    readonly off: Client['off']
    readonly tag: string
}

const trace: string[] = []

/** Producer 1: a factory that builds a literal and SPREADS it into the
 * value it hands out -- the shape zapo's plugin installer uses. Each call
 * captures its own `tag`, so four calls make four distinct bodies' worth of
 * captured state behind one slot. */
function makeCtx(tag: string): Ctx {
    const base: Ctx = {
        tag: 'base',
        on<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
            trace.push('F[' + tag + '].on:' + event)
        },
        off<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
            trace.push('F[' + tag + '].off:' + event)
        }
    }
    return { ...base, tag }
}

/** Producer 2: a different literal with a different body, satisfying the
 * same interface. If the call site monomorphized against one producer's
 * declaration instead of reading the slot, this one's lines never appear. */
const other: Ctx = {
    tag: 'other',
    on<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
        trace.push('OTHER.on<' + event + '>')
    },
    off<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
        trace.push('OTHER.off<' + event + '>')
    }
}

/** The consumer: an INTERFACE-typed parameter, which is the receiver form
 * that has no declaration of its own to monomorphize against. */
function sub(ctx: Ctx): void {
    const onA = (e: EvA): void => {
        trace.push('a=' + String(e.x))
    }
    const onB = (e: EvB): void => {
        trace.push('b=' + e.y)
    }
    ctx.on('a', onA)
    ctx.on('b', onB)
    ctx.off('a', onA)
    trace.push('tag=' + ctx.tag)
}

sub(makeCtx('one'))
sub(other)
// The receiver chosen at RUN TIME: no static analysis names this one.
const chosen: Ctx = process.argv.length > 900 ? makeCtx('never') : other
sub(chosen)
// ...and through an array, where the element type is the interface and the
// values alternate between the two producers.
const all: Ctx[] = [makeCtx('p'), other, makeCtx('q')]
for (const c of all) sub(c)

for (const line of trace) console.log(line)
