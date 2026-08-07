// `arguments` in a function that ALSO declares parameters.
//
// The arguments object is the CALL's argument list, never the DECLARATION's:
// its length is the count the caller passed, index i is the i-th argument
// whether or not a parameter was declared for it, and a parameter the call
// did not fill reads undefined off the end of the same list. So the two
// spellings must answer together at every arity — short calls, exact calls
// and surplus calls alike.
//
// STRICT (the directive below): a parameter binding and its arguments slot
// are INDEPENDENT — writing one never shows up in the other. (Sloppy mode
// aliases them; that file is 2768, and the writing shapes stay fenced there.)
//
// (Array.isArray(arguments) answers true here where Node says false — the
// checked-dynamic tree carries a real array; SEMANTICS.md — so it stays
// unprobed, exactly as 1703 leaves it.)
'use strict';

// Every arity against a 3-parameter declaration.
function arity(a, b, c) {
  return `${arguments.length}|${a}|${b}|${c}|${arguments[0]}|${arguments[2]}|${arguments[3]}`;
}
console.log(arity());
console.log(arity(1));
console.log(arity(1, 2));
console.log(arity(1, 2, 3));
console.log(arity(1, 2, 3, 4, 5));

// A parameter is an ordinary mutable binding; in strict code the slot does
// not follow it, and the slot does not drag the binding along either.
function noAlias(x) {
  x = 'rebound';
  return `${x} ${arguments[0]} ${arguments.length}`;
}
console.log(noAlias('orig'));
function noAliasBack(x) {
  arguments[0] = 'slot';
  return `${x} ${arguments[0]} ${arguments.length}`;
}
console.log(noAliasBack('orig'));

// The same shape as a function EXPRESSION, reached directly and through an
// alias binding: the direct completion and the boxed-call thunk both pack
// the WHOLE list, so both spellings agree.
const tail = function (head) {
  var out = [];
  for (var i = 1; i < arguments.length; i++) out.push(arguments[i]);
  return head + '<' + out.join('|') + '>';
};
console.log(tail('h'), tail('h', 1), tail('h', 1, 2, 3));
const aliased = tail;
console.log(aliased('z'), aliased('z', 'q'));

// The EventEmitter.emit shape: a leading named parameter, the rest of the
// call forwarded to listeners that are themselves variadic.
function Em() { this._l = {}; }
Em.prototype.on = function (n, f) { (this._l[n] = this._l[n] || []).push(f); return this; };
Em.prototype.emit = function (n) {
  var l = this._l[n];
  if (!l) return this;
  var a = [];
  for (var i = 1; i < arguments.length; i++) a.push(arguments[i]);
  for (var j = 0; j < l.length; j++) l[j].apply(null, a);
  return this;
};
const em = new Em();
em.on('x', function (p, q) { console.log('handler', arguments.length, p, q); });
em.emit('x');
em.emit('x', 'A');
em.emit('x', 'A', 'B', 'C');
em.emit('unheard', 'A');

// protobufjs's util.merge: whether the last argument is a flag is a fact
// about the CALL's arity, so the declared parameter list cannot answer it.
function merge(dst) {
  var flag = typeof arguments[arguments.length - 1] === 'boolean';
  var n = flag ? arguments.length - 1 : arguments.length;
  var ifNotSet = flag && arguments[arguments.length - 1];
  for (var i = 1; i < n; ++i) {
    var src = arguments[i];
    if (src) {
      var ks = Object.keys(src);
      for (var k = 0; k < ks.length; ++k) {
        if (dst[ks[k]] === undefined || !ifNotSet) dst[ks[k]] = src[ks[k]];
      }
    }
  }
  return JSON.stringify(dst);
}
console.log(merge({ a: 1 }));
console.log(merge({ a: 1 }, { b: 2 }));
console.log(merge({ a: 1 }, { a: 9, b: 2 }, true));
console.log(merge({ a: 1 }, { a: 9, b: 2 }, { c: 3 }, false));

// A nested function declaration owns its own arguments — the enclosing
// one's list is not visible inside it.
function outer(o) {
  function inner(i) { return `${arguments.length}/${i}/${arguments[1]}`; }
  return `${arguments.length}:${o} ${inner('one', 'two')}`;
}
console.log(outer('P', 'Q'));

// Recursion: each activation sees its own call's arity.
function tally(seed) {
  if (arguments.length > 3) return `deep ${arguments.length} ${seed}`;
  return tally(seed, 0, 0, 0, 0);
}
console.log(tally(1));

// The declared parameter still shadows an outer binding of the same name,
// and `var` of the same name inside the body is the same binding.
var head = 'outer-head';
function shadow(head) {
  var seen = head;
  head = 'inner';
  return `${seen} ${head} ${arguments[0]} ${arguments.length}`;
}
console.log(shadow('passed'), head);

console.log('done');
