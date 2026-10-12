// `exports[<key>] = <expr>` is the SAME attachment as `exports.<name> =`,
// spelled with a key: Node defines the property the key names and nothing
// else differs. When the key is a LITERAL the property name is a
// compile-time constant and the statement lowers like its sibling; when it
// is anything the runtime decides, it is not an export assignment this
// compiler can see and the bare `exports` receiver keeps its fence.
//
// The numeric-literal gate is narrower than "is a NumericLiteral": the
// property Node attaches is ToString of the literal's VALUE, so a spelling
// that does not round-trip (`1e400` attaches "Infinity") is refused rather
// than named by its own text.
'use strict';

// --- ADMITTED: a literal key names one property, known here. ---
exports.EE_READ = 2;
exports[2] = 'EE_READ';
exports['a key no identifier can spell'] = 'ok';
exports[0x10] = 'a non-decimal spelling of 16';

// --- REFUSED, and this half is the point of the fixture: widening the
// admission to the general element access would turn each of these into a
// property named at compile time that Node names at run time. ---
const k = 'computed';
let n = 1;
exports[k] = 'an identifier key';
exports[n + 1] = 'an arithmetic key';
exports[`t${n}`] = 'a template key';
exports[String(n)] = 'a call-expression key';
exports[1e400] = 'a literal whose property is "Infinity", not its spelling';
