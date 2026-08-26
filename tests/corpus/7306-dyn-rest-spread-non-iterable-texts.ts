// A NON-ITERABLE spread source throws a TypeError whose text V8 picks by
// the spread's syntactic position: the optimized apply path (a SOLE
// spread in LAST position) names the EXPRESSION, the real iterator
// protocol names the VALUE. Both texts must match byte for byte.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
function take(...args: unknown[]): void {
  console.log(fmt(args))
}
function show(tag: string, f: () => void): void {
  try {
    f()
    console.log(tag + ": no throw")
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    console.log(tag + ": " + (e instanceof TypeError ? "TypeError" : "Other") + ": " + m)
  }
}

const nul: any = null
const und: any = undefined
const num: any = 5
const obj: any = { a: 1 }
const boo: any = true
const good: any = [1, 2]

// SOLE spread, LAST position -- the optimized apply-path text.
show("sole/null", () => { take(...nul) })
show("sole/undefined", () => { take(...und) })
show("sole/number", () => { take(...num) })
show("sole/object", () => { take(...obj) })
show("sole/boolean", () => { take(...boo) })

// NOT sole / NOT last -- the iterator-protocol text.
show("mid/null", () => { take(...nul, "after") })
show("mid/undefined", () => { take(...und, "after") })
show("mid/number", () => { take(...num, "after") })
show("mid/object", () => { take(...obj, "after") })

show("two/second-bad", () => { take(...good, ...obj) })
show("two/first-bad", () => { take(...obj, ...good) })
show("last-but-not-sole", () => { take("head", ...obj) })
