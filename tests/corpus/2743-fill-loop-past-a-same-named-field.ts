// The counting-loop proof behind `new Array<T>(n)`, read past a FIELD that
// happens to share the local's name.
//
// `new Array(n)` refuses element types with no honest absent value — a
// scalar slot would read 0 where Node reads undefined. The exception is a
// loop that writes every index before anything can read one, and its proof
// asks, among other things, "does the loop body mention the array
// anywhere except the write?".
//
// That question was answered by walking for ANY identifier with the
// array's text, so `this.keys.get(...)` counted as a mention of a local
// called `keys` and the proof collapsed. The name half of a property
// access binds nothing: it names a member of the receiver, never the
// binding in scope. Reading it as a reference is simply wrong, and the
// shape it breaks — a batch getter whose local is named after the field it
// reads — is the ordinary way to write one.
//
// The receiver half is still walked (`keys.get(...)` IS a mention), and an
// ELEMENT access `obj[keys]` is untouched, because its argument is a real
// reference.
//
// What this pins against Node: the clashing-name loop and a clean-name
// twin producing identical output; a genuine read-back of the array inside
// the loop, which must KEEP its fence and is therefore written here in the
// form that still compiles (a filled array read after the loop); the
// element type carrying null, which is the union shape the idiom is
// written for; and a nested-array element type so refcounting of the
// written slots is exercised.

class Batches {
    private readonly keys = new Map<string, number>()
    private readonly rows = new Map<string, readonly number[]>()

    public put(k: string, v: number): void {
        this.keys.set(k, v)
        this.rows.set(k, [v, v * 2])
    }

    // The clash: the local is `keys` and the body reads `this.keys`.
    public keysBatch(ids: readonly string[]): readonly (number | null)[] {
        const keys = new Array<number | null>(ids.length)
        for (let index = 0; index < ids.length; index += 1) {
            keys[index] = this.keys.get(ids[index]) ?? null
        }
        return keys
    }

    // The same loop with a local that clashes with nothing — identical
    // output, so a divergence between the two is a bug in the proof.
    public keysBatchClean(ids: readonly string[]): readonly (number | null)[] {
        const out = new Array<number | null>(ids.length)
        for (let index = 0; index < ids.length; index += 1) {
            out[index] = this.keys.get(ids[index]) ?? null
        }
        return out
    }

    // A REFCOUNTED element type through the same proof.
    public rowsBatch(ids: readonly string[]): readonly (readonly number[] | null)[] {
        const rows = new Array<readonly number[] | null>(ids.length)
        for (let index = 0; index < ids.length; index += 1) {
            rows[index] = this.rows.get(ids[index]) ?? null
        }
        return rows
    }

    // The clash under `i++` instead of `i += 1`, and with the write's
    // right-hand side calling a method on the same-named field.
    public sums(ids: readonly string[]): readonly number[] {
        const keys = new Array<number>(ids.length)
        for (let i = 0; i < ids.length; i++) {
            keys[i] = (this.keys.get(ids[i]) ?? 0) + 1
        }
        return keys
    }
}

// WHAT KEEPS ITS FENCE, verified by watching the build refuse it rather
// than written here as a compiled assertion:
//   - a loop body that reads the array back (`acc[i] = (acc[0] ?? 0) + 1`):
//     a slot IS readable before it is written, which is exactly what the
//     proof exists to rule out. The property-access correction does not
//     touch it — `acc[0]` is an element access on the array itself.
//   - a body with `continue`/`break`/`return`, which could leave the tail
//     unwritten with the array still reachable.

function main(): void {
    const b = new Batches()
    b.put('a', 1)
    b.put('c', 3)
    const ids = ['a', 'b', 'c']
    console.log(`keys ${JSON.stringify(b.keysBatch(ids))}`)
    console.log(`clean ${JSON.stringify(b.keysBatchClean(ids))}`)
    console.log(`rows ${JSON.stringify(b.rowsBatch(ids))}`)
    console.log(`sums ${JSON.stringify(b.sums(ids))}`)
    console.log(`empty ${JSON.stringify(b.keysBatch([]))}`)
}

main()
export {}
