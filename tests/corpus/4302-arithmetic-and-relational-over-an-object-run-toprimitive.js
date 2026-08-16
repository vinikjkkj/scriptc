// The rest of the ToPrimitive family. `==` is not a corner: ToPrimitive is
// what `+`, the relational four, ToNumber and every arithmetic and bitwise
// operator perform on an untyped operand BEFORE they compute.
//
// On base scr_dyn_add, scr_dyn_rel and scr_dyn_to_number opened with the
// same `scr_dyn_is_prim` guard and answered a reference kind with the loud
// dynCheck refusal ("expected number at $, got object" / "expected a number
// or a string at $, got object"), so every line below that touches an
// object threw where Node answers. That refusal was not a wrong answer, so
// nothing here is a bug fix in the census sense -- it is the family the
// new runtime primitive closes, and it is measured because a helper that
// serves one call site is worth much less than one that closes a family.
//
// The controls that must NOT move are at the bottom: a bigint keeps its
// documented refusal, and `"" + o` (which already ran the protocol through
// scr_dyn_to_primitive_string) must answer exactly what it answered before.
'use strict';

function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + ' = ' + s);
}
function T(tag, f) {
  try {
    show(tag, f());
  } catch (e) {
    show(tag, 'caught ' + e.name + ': ' + e.message);
  }
}

var vo = { valueOf: function () { return 2; } };
var both = { valueOf: function () { return 2; }, toString: function () { return 'T'; } };
var tsOnly = { toString: function () { return '4'; } };

// --- `+` with a NUMBER on the other side: ToPrimitive, then addition ----
show('vo + 1', boxed(vo) + 1);
show('1 + vo', 1 + boxed(vo));
show('both + 1', boxed(both) + 1);
show('tsOnly + 1', boxed(tsOnly) + 1);
show('[] + 1', boxed([]) + 1);
show('[3] + 1', boxed([3]) + 1);
show('[1,2] + 1', boxed([1, 2]) + 1);
show('{} + 1', boxed({}) + 1);

// `+` with two untyped operands.
show('vo + vo', boxed(vo) + boxed(vo));
show('vo + tsOnly', boxed(vo) + boxed(tsOnly));
show('tsOnly + tsOnly', boxed(tsOnly) + boxed(tsOnly));

// --- relational: hint NUMBER, and BOTH strings compare AS strings -------
show('vo < 3', boxed(vo) < 3);
show('vo > 3', boxed(vo) > 3);
show('vo <= 2', boxed(vo) <= 2);
show('vo >= 2', boxed(vo) >= 2);
show('tsOnly < 5', boxed(tsOnly) < 5);
show('[] < 1', boxed([]) < 1);
show('[2] < [10]', boxed([2]) < boxed([10]));
show('tsOnly < tsOnly', boxed(tsOnly) < boxed(tsOnly));

// The string-hint reversal is NOT relational's: `<` passes hint number, so
// `both` answers 2 here and "T" only through String().
show('both < 3', boxed(both) < 3);
show('String(both)', String(boxed(both)));

// --- ToNumber over an object -------------------------------------------
show('Number(vo)', Number(boxed(vo)));
show('Number(both)', Number(boxed(both)));
show('Number(tsOnly)', Number(boxed(tsOnly)));
show('Number([])', Number(boxed([])));
show('Number([7])', Number(boxed([7])));
show('Number([1,2])', Number(boxed([1, 2])));
show('Number({})', Number(boxed({})));

// --- unary and the arithmetic/bitwise operators -------------------------
show('-vo', -boxed(vo));
show('+vo', +boxed(vo));
show('~vo', ~boxed(vo));
show('vo * 3', boxed(vo) * 3);
show('vo - 1', boxed(vo) - 1);
show('vo / 4', boxed(vo) / 4);
show('vo % 2', boxed(vo) % 2);
show('vo | 0', boxed(vo) | 0);
show('vo & 3', boxed(vo) & 3);
show('vo << 2', boxed(vo) << 2);

// --- where the protocol is exhausted, JS throws -------------------------
T('Number(null-prototype)', function () { return Number(boxed(Object.create(null))); });
T('null-prototype + 1', function () { return boxed(Object.create(null)) + 1; });
T('null-prototype < 1', function () { return boxed(Object.create(null)) < 1; });

// A throwing valueOf propagates through each of them.
var vthrow = { valueOf: function () { throw new RangeError('nope'); } };
T('Number(throwing valueOf)', function () { return Number(boxed(vthrow)); });
T('throwing valueOf + 1', function () { return boxed(vthrow) + 1; });
T('throwing valueOf < 1', function () { return boxed(vthrow) < 1; });

// --- evaluate-once ------------------------------------------------------
var calls = 0;
var counted = { valueOf: function () { calls++; return 1; } };
show('counted + 1', boxed(counted) + 1);
show('valueOf call count', calls);

// --- CONTROLS that must not move ---------------------------------------
// The string-hint spellings already ran the protocol before this change.
show('control "" + both', '' + boxed(both));
show('control String(vo)', String(boxed(vo)));
show('control template both', `${boxed(both)}`);
show('control "" + plain', '' + boxed({ a: 1 }));
show('control "" + array', '' + boxed([1, 2]));
// Primitive operands are untouched.
show('control 2 + 1 boxed', boxed(2) + 1);
show('control "a" + 1 boxed', boxed('a') + 1);
show('control null + 1 boxed', boxed(null) + 1);
show('control undefined + 1', boxed(undefined) + 1);
show('control true + 1 boxed', boxed(true) + 1);
show('control 2 < 3 boxed', boxed(2) < 3);
show('control "a" < "b" boxed', boxed('a') < boxed('b'));

console.log('done');
