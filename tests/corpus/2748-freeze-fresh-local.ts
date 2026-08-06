// Object.freeze over a FRESH FUNCTION-LOCAL — the accumulate-then-publish
// idiom, which is the literal arm of the freeze lowering with the
// allocation a few statements earlier instead of in the argument
// position. What the compiler has to prove is that nothing else holds the
// value when the freeze runs and nothing can write through it afterwards;
// this fixture pins the RESULTS of the shapes that proof accepts.
//
// The shapes it declines keep their SC2020 fence and so cannot appear
// here — a corpus program must build. They are, and each is refused for
// its own reason: a binding whose initializer is not a literal (the
// allocation is somebody else's), a reference from a nested function
// (whose run time cannot be bounded), a reference that hands the value to
// a callback-taking method like forEach/map (which receives the array as
// its third argument), sort/reverse (which RETURN the receiver), and a
// freeze inside a loop the declaration sits outside of (the earlier
// mutations would run again, after the freeze).

// The idiom itself: dedupe into a local, publish it frozen.
function unique(urls: readonly string[]): readonly string[] {
    const out: string[] = []
    for (const u of urls) {
        if (out.indexOf(u) === -1) {
            out.push(u)
        }
    }
    return Object.freeze(out)
}

const a = unique(["b", "a", "b", "c", "a"])
console.log(a.length, a.join("|"))
console.log(unique([]).length)
console.log(unique(["x"]).join("|"))

// Every whitelisted receiver method, and a write target beside them.
function built(): readonly number[] {
    const xs: number[] = []
    xs.push(1)
    xs.push(2)
    xs.push(3)
    xs.unshift(0)
    console.log("includes", xs.includes(2), "indexOf", xs.indexOf(3))
    xs.pop()
    xs.shift()
    xs[0] = 9
    return Object.freeze(xs)
}
const b = built()
console.log(b.length, b.join(","))

// An OBJECT literal local, filled by keyed writes.
function table(): Readonly<Record<string, string>> {
    const t: Record<string, string> = {}
    t["one"] = "1"
    t["two"] = "2"
    t.three = "3"
    return Object.freeze(t)
}
const t = table()
console.log(t["one"], t["two"], t.three)

// The declaration INSIDE the loop: each iteration allocates its own
// array, so a freeze per iteration is the literal case repeated.
const rows: readonly string[][] = (() => {
    const acc: string[][] = []
    for (let i = 0; i < 3; i++) {
        const row: string[] = []
        row.push("r" + String(i))
        row.push("v" + String(i * 2))
        acc.push(Object.freeze(row) as string[])
    }
    return acc
})()
for (const r of rows) {
    console.log(r.join("/"))
}

// The frozen array is an ordinary value afterwards: reads, iteration and
// spread all answer what they did before the freeze.
console.log([...a].reverse().join("|"))
console.log(a.map((s) => s.toUpperCase()).join("|"))
