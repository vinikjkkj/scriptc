// A STRING spread source. JS spreads a string BY CODE POINT, so an
// astral character contributes ONE element of length 2, not two lone
// surrogates.
function take(...args: unknown[]): void {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + "|"
    const s = String(args[i])
    line = line + s + "(" + String(s.length) + ")"
  }
  console.log(line + "]")
}
const plain = "abc"
take(...plain)

const astral = String.fromCodePoint(0x1f600)
take(...astral)

const mixed = "a" + String.fromCodePoint(0x1f600) + "b"
take(...mixed)

// A lone high surrogate is its own element.
const lone = "x" + String.fromCharCode(0xd83d) + "y"
take(...lone)

const empty = ""
take(...empty)

take("L", ...mixed, "R")
