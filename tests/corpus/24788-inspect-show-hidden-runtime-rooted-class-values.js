import util from "node:util";
import { EventEmitter } from "node:events";
import { Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
function show(v) { for (const o of [H, HC, HD]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
class E1 extends Error { constructor() { super(); } m() {} get eg() { return 1; } static es = 1; }
class E2 extends E1 { constructor() { super(); } n() {} }
class E3 extends E2 { constructor() { super(); } }
class E4 extends E3 { constructor() { super(); } get e4() { return 1; } }
class T1 extends TypeError { constructor() { super(); } }
class T2 extends T1 { constructor() { super(); } }
class T3 extends T2 { constructor() { super(); } }
class R1 extends RangeError { constructor() { super(); } }
class S1 extends SyntaxError { constructor() { super(); } static q = 3; }
class F1 extends ReferenceError { constructor() { super(); } }
class EE1 extends EventEmitter { constructor() { super(); } m() {} }
class EE2 extends EE1 { constructor() { super(); } n() {} get g2() { return 1; } static t = 2; }
class EE3 extends EE2 { constructor() { super(); } }
class EE4 extends EE3 { constructor() { super(); } }
class RD1 extends Readable { constructor() { super(); } m() {} }
class RD2 extends RD1 { constructor() { super(); } n() {} }
class RD3 extends RD2 { constructor() { super(); } }
class WR1 extends Writable { constructor() { super(); } m() {} static w = 1; }
class DU1 extends Duplex { constructor() { super(); } m() {} }
class TR1 extends Transform { constructor() { super(); } m() {} }
class PT1 extends PassThrough { constructor() { super(); } m() {} }
class PT2 extends PT1 { constructor() { super(); } }
show(JSON.parse("0") || E1);
show(JSON.parse("0") || E2);
show(JSON.parse("0") || E3);
show(JSON.parse("0") || E4);
show(JSON.parse("0") || T1);
show(JSON.parse("0") || T2);
show(JSON.parse("0") || T3);
show(JSON.parse("0") || R1);
show(JSON.parse("0") || S1);
show(JSON.parse("0") || F1);
Error.stackTraceLimit = 3;
show(JSON.parse("0") || E1);
Error.stackTraceLimit = 10;
show(JSON.parse("0") || EE1);
show(JSON.parse("0") || EE2);
show(JSON.parse("0") || EE3);
show(JSON.parse("0") || EE4);
show(JSON.parse("0") || RD1);
show(JSON.parse("0") || RD2);
show(JSON.parse("0") || RD3);
show(JSON.parse("0") || WR1);
show(JSON.parse("0") || DU1);
show(JSON.parse("0") || TR1);
show(JSON.parse("0") || PT1);
show(JSON.parse("0") || PT2);
show({ nested: JSON.parse("0") || RD1 });
