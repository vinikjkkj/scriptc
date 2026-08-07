// `arguments` with declared parameters in SLOPPY code (a .cjs script with no
// directive prologue — the spelling every bundled CommonJS payload uses).
//
// Sloppy mode ALIASES a simple parameter list to the arguments slots: writing
// `x` shows through `arguments[0]` and back. The lowering re-binds the
// parameters off the arguments array by COPY, which is the strict-mode answer,
// so sloppy bodies that write either side keep the compile-time refusal
// (tests/diagnostics covers that half — a loud refusal cannot be probed from a
// differential program). Everything that only READS both sides answers the
// same in both modes, and that is this file.
//
// The shape under test is protobufjs's `aspromise`: a two-parameter function
// whose tail is the caller's surplus, wrapping a one-parameter callback whose
// own tail is the callee's — both variadic through `arguments`, both reached
// indirectly, and the outer one forwarding through a dyn `.apply`.

function tailOf(head) {
  var out = [];
  for (var i = 1; i < arguments.length; i++) out.push(arguments[i]);
  return head + '<' + out.join('|') + '>';
}
console.log(tailOf('h'), tailOf('h', 1), tailOf('h', 1, 2));

function asPromise(fn, ctx) {
  var args = [], r = 2, pending = true;
  while (r < arguments.length) { args.push(arguments[r]); r++; }
  return new Promise(function (resolve, reject) {
    args.push(function (err) {
      if (pending) {
        pending = false;
        if (err) {
          reject(err);
        } else {
          var params = [], j = 1;
          while (j < arguments.length) { params.push(arguments[j]); j++; }
          resolve(params.join('+'));
        }
      }
    });
    try {
      fn.apply(ctx || null, args);
    } catch (e) {
      if (pending) { pending = false; reject(e); }
    }
  });
}

function svc(a, b, cb) { cb(null, a + b, a * b); }
function nullary(cb) { cb(null); }
function bad(cb) { cb(new Error('nope')); }
function thrower() { throw new Error('sync'); }

asPromise(svc, null, 3, 4)
  .then(function (v) { console.log('ok', JSON.stringify(v)); }, function (e) { console.log('err', e.message); })
  .then(function () {
    return asPromise(nullary, null).then(function (v) { console.log('ok', JSON.stringify(v)); });
  })
  .then(function () {
    return asPromise(bad, null).then(function (v) { console.log('ok', v); }, function (e) { console.log('err', e.message); });
  })
  .then(function () {
    return asPromise(thrower, null).then(function (v) { console.log('ok', v); }, function (e) { console.log('err', e.message); });
  })
  .then(function () { console.log('done'); });
