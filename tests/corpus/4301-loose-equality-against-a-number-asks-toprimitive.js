// `n == v` / `n != v` where v is untyped. On base this whole file is
// SC1040 ("loose equality (== and !=) is not supported yet"): the lowering
// answered only SAME-KIND pairs, so a number against an unknown fenced.
//
// The cases below are derived from Node v25.9.0 FIRST and then checked
// against the implementation, not the other way round -- a fixture written
// from the implementation cannot find what the implementation forgot. Four
// of them would pass a plausible wrong implementation:
//
//   * `0 == null` is FALSE even though Number(null) is 0. The spec compares
//     TYPES before it converts, so the unit arms must be answered BEFORE
//     ToPrimitive, not through it.
//   * `0 == {valueOf(){return false}}` is TRUE. ToPrimitive answers the
//     BOOLEAN false and ToNumber(false) is 0. Routing `==` through the
//     runtime's existing scr_dyn_to_primitive_string would answer "false",
//     whose ToNumber is NaN, and get this wrong.
//   * `0 == {valueOf(){return null}}` is FALSE -- the comparison RESTARTS on
//     the primitive, so the unit answer applies to a converted value too.
//   * an object with only toString (protobufjs's Long, the live consumer in
//     zapo's bundle) must fall THROUGH Object.prototype.valueOf, which
//     answers the object itself and is not a primitive. A valueOf-only
//     implementation refuses the one package this route exists for.
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

// --- the primitive right-hand sides: no conversion, or ToNumber ---------
show('0 == null', 0 == boxed(null));
show('0 == undefined', 0 == boxed(undefined));
show('0 == empty string', 0 == boxed(''));
show('0 == "0"', 0 == boxed('0'));
show('0 == "abc"', 0 == boxed('abc'));
show('0 == false', 0 == boxed(false));
show('0 == true', 0 == boxed(true));
show('1 == true', 1 == boxed(true));
show('0 == 0', 0 == boxed(0));
show('0 == -0', 0 == boxed(-0));
show('0 == NaN', 0 == boxed(NaN));
show('5 == "5"', 5 == boxed('5'));
show('5 == " 5 "', 5 == boxed(' 5 '));
show('0 == " "', 0 == boxed(' '));
show('1e21 == "1e21"', 1e21 == boxed('1e21'));

// --- the same pairs NEGATED --------------------------------------------
show('0 != null', 0 != boxed(null));
show('0 != ""', 0 != boxed(''));
show('0 != "abc"', 0 != boxed('abc'));

// --- the REVERSED spelling: the value on the left ----------------------
show('null == 0', boxed(null) == 0);
show('"" == 0', boxed('') == 0);
show('"abc" != 0', boxed('abc') != 0);
show('false == 0', boxed(false) == 0);

// --- objects: ToPrimitive with the DEFAULT hint ------------------------
show('0 == {}', 0 == boxed({}));
show('0 == []', 0 == boxed([]));
show('0 == [0]', 0 == boxed([0]));
show('0 == [1]', 0 == boxed([1]));
show('1 == [1]', 1 == boxed([1]));
show('0 == [[]]', 0 == boxed([[]]));
show('0 == [null]', 0 == boxed([null]));
show('0 == [1,2]', 0 == boxed([1, 2]));

// The boolean answer -- the one a stringifying ToPrimitive gets wrong.
show('0 == valueOf false', 0 == boxed({ valueOf: function () { return false; } }));
show('1 == valueOf true', 1 == boxed({ valueOf: function () { return true; } }));
show('0 == valueOf true', 0 == boxed({ valueOf: function () { return true; } }));

// The comparison RESTARTS on the primitive, so a unit answer still wins.
show('0 == valueOf null', 0 == boxed({ valueOf: function () { return null; } }));
show('0 == valueOf undefined', 0 == boxed({ valueOf: function () { return undefined; } }));

show('0 == valueOf empty string', 0 == boxed({ valueOf: function () { return ''; } }));
show('0 == valueOf "0"', 0 == boxed({ valueOf: function () { return '0'; } }));
show('0 == valueOf "abc"', 0 == boxed({ valueOf: function () { return 'abc'; } }));
show('7 == valueOf 7', 7 == boxed({ valueOf: function () { return 7; } }));
show('0 == toString "0"', 0 == boxed({ toString: function () { return '0'; } }));

// valueOf FIRST for the default hint: this object answers 1, not "2".
show('1 == valueOf1 toString2', 1 == boxed({
  valueOf: function () { return 1; },
  toString: function () { return '2'; },
}));
show('2 == valueOf1 toString2', 2 == boxed({
  valueOf: function () { return 1; },
  toString: function () { return '2'; },
}));

// valueOf returning an OBJECT falls through to toString.
show('3 == valueOf obj then toString 3', 3 == boxed({
  valueOf: function () { return {}; },
  toString: function () { return '3'; },
}));

// The prototype chain counts -- ToPrimitive is a [[Get]].
function K() {}
K.prototype.valueOf = function () { return 5; };
show('5 == proto valueOf', 5 == boxed(new K()));

// THE LIVE CONSUMER's shape: protobufjs's Long defines toString and no
// valueOf, so Object.prototype.valueOf answers the object and ToPrimitive
// must fall through it. Transcribed from the bundle:
//   function n(e,t,n){this.low=0|e,this.high=0|t,this.unsigned=!!n}
function Long(lo, hi) {
  this.low = 0 | lo;
  this.high = 0 | hi;
}
Long.prototype.toString = function () {
  return String(this.high * 4294967296 + (this.low >>> 0));
};
show('0 == Long(0,0)', 0 == boxed(new Long(0, 0)));
show('1 == Long(1,0)', 1 == boxed(new Long(1, 0)));
show('0 == Long(1,0)', 0 == boxed(new Long(1, 0)));
show('4294967296 == Long(0,1)', 4294967296 == boxed(new Long(0, 1)));

// And the expression the two SC1040 traps actually are, over that shape:
// `this.high` is `0|t`, so it is always an int32 and the object arm above
// is never reached from THIS site -- which is the point of checking both.
function numBitsHigh(l) {
  return 0 != l.high;
}
show('0 != Long(0,0).high', numBitsHigh(boxed(new Long(0, 0))));
show('0 != Long(0,1).high', numBitsHigh(boxed(new Long(0, 1))));

// --- the arm where JS really throws ------------------------------------
T('0 == null-prototype object', function () {
  return 0 == boxed(Object.create(null));
});
var np = Object.create(null);
np.toString = function () { return '0'; };
show('0 == null-proto with toString', 0 == boxed(np));

// A throwing valueOf is the program's throw, and toString is NOT tried.
var reached = 0;
var vthrow = boxed({
  valueOf: function () { throw new TypeError('valueOf says no'); },
  toString: function () { reached++; return '0'; },
});
T('0 == throwing valueOf', function () {
  return 0 == vthrow;
});
show('toString reached', reached);

// --- the operand is evaluated exactly ONCE -----------------------------
var calls = 0;
function once() {
  calls++;
  return boxed(0);
}
show('0 == once()', 0 == once());
show('once call count', calls);
calls = 0;
show('once() == 0', once() == 0);
show('once call count reversed', calls);

// --- controls: the SAME-KIND pairs that already lowered ----------------
show('control 1 == 1', 1 == 1);
show('control "a" == "a"', 'a' == 'a');
show('control true == true', true == true);
show('control x == null', boxed(null) == null);
show('control x != null', boxed(7) != null);

console.log('done');
