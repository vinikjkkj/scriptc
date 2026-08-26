/* `var hasOwnProperty = Object.prototype.hasOwnProperty` at the top of a
 * file, then `hasOwnProperty.call(o, k)` in the functions: the hoisted-alias
 * spelling of the member-access idiom the lowering already recognized. The
 * DECLARATION alone used to stop the file -- reading Object.prototype has
 * no lowering -- so the alias never reached the call it exists for.
 *
 * xtend/mutable.js is three lines of exactly this, and pg reaches it through
 * postgres-interval, so it ran at module init of a Postgres client and
 * killed the program before it opened a socket.
 *
 * The receiver here is a checked-dynamic value (JSON.parse), which is the
 * arm the call lowers over: a record with DECLARED fields keeps its fence
 * (the explicit-undefined-is-absent divergence), and that boundary is not
 * moved by this. */
'use strict';

var hasOwnProperty = Object.prototype.hasOwnProperty;

function has(o, k) {
  return hasOwnProperty.call(o, k);
}

var probe = JSON.parse('{"a":1,"b":null,"toString":2}');
console.log(has(probe, 'a'), has(probe, 'b'), has(probe, 'c'));
// Inherited names are NOT own properties -- the whole reason the idiom is
// written this way -- except where the object really carries one.
console.log(has(probe, 'toString'), has(probe, 'valueOf'), has(probe, 'hasOwnProperty'));

var empty = JSON.parse('{}');
console.log(has(empty, 'a'), has(empty, 'constructor'));
