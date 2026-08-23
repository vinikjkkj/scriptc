// The other half of 6020: a builtin value must ANSWER what the direct
// call answers, at every edge the builtin has.
//
// The lift's body is the same libCall the direct call lowers to, so this
// should be tautological -- which is exactly why it is worth pinning. The
// day someone reimplements a body here instead of routing it, this is the
// fixture that notices, and it notices at the edges (a partial parse, an
// empty string, the reserved/unreserved URI sets, a malformed escape's
// URIError) rather than on the happy value everyone tries first.
//
// Each line prints the value form's answer and the direct call's answer
// side by side, so a divergence between them is visible even in a run
// nobody diffs against Node.

const vIsNaN = isNaN
const vIsFinite = isFinite
const vParseFloat = parseFloat
const vEncodeURI = encodeURI
const vDecodeURIComponent = decodeURIComponent

const numbers: number[] = [0, -0, 1, -1, 0.5, 1e21, 1 / 0, -1 / 0, 0 / 0, 9007199254740993]
for (const n of numbers) {
    console.log(vIsNaN(n), isNaN(n), vIsFinite(n), isFinite(n))
}

const texts: string[] = ['3.5', '3.5x', '  12.25  ', '', 'abc', '-0', '1e3', 'Infinity', '-Infinity', '.5', '0x10']
for (const s of texts) {
    console.log(vParseFloat(s), parseFloat(s))
}

const uris: string[] = ['a b/c?d=e&f', 'http://x/y z', "A-_.!~*'()", ';,/?:@&=+$#', 'ü', '']
for (const s of uris) {
    console.log(vEncodeURI(s), encodeURI(s))
}

const encoded: string[] = ['a%20b%2Fc', '%C3%BC', 'plain', '%41%42', '']
for (const s of encoded) {
    console.log(vDecodeURIComponent(s), decodeURIComponent(s))
}

// A malformed escape is a URIError in Node, and it must be one through the
// value too. A value form that swallowed it would be the quietest possible
// divergence -- a program that keeps running with a half-decoded string.
try {
    console.log('unreachable', vDecodeURIComponent('%E0%A4%A'))
} catch (e) {
    console.log('value', (e as Error).name)
}
try {
    console.log('unreachable', decodeURIComponent('%E0%A4%A'))
} catch (e) {
    console.log('direct', (e as Error).name)
}
