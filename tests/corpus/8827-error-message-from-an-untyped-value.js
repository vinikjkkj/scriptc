// The message of an Error constructor is ToString(argument) unless the
// argument is undefined: a JS class's `constructor(msg) { super(msg) }` hands
// it an untyped value. It was SC1090 "Error messages of type 'unknown' (the
// message must be a string)".
'use strict';

class E1 extends Error {
  constructor(msg) { super(msg); this.name = "E1"; }
}
function mk(m) { return new E1(m); }
function plain(m) { return new Error(m); }
function typed(m) { return new TypeError(m); }

const msgs = [
  mk("a").message,
  mk(5).message,
  mk(undefined).message,
  mk(null).message,
  mk(true).message,
  mk({ toString() { return "obj"; } }).message,
  mk([1, 2]).message,
  plain("p").message,
  plain(1.5).message,
  plain().message,
  plain(false).message,
  typed("t").message,
];
console.log(JSON.stringify(msgs));
console.log(mk(7).name, mk(7).message + "!", String(mk("z")));
