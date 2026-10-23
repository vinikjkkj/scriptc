// TextEncoder and TextDecoder reached through a receiver the compiler
// cannot type. The static side represents each by the one string it
// carries ("utf-8"), so an instance that escaped into an untyped slot used
// to BE that string: typeof said "string", `.encoding` read undefined, and
// `.encode` / `.decode` threw "is not a function" where Node answers — a
// clean build with a wrong answer. A codec is now boxed as an object at the
// boundary, with its members, its tag, and Node's argument checks.
'use strict';

function bytes(u) { const o = []; for (let i = 0; i < u.length; i++) o.push(u[i]); return o.join(","); }

function T(name, f) {
  try {
    const r = f();
    if (r instanceof Uint8Array) console.log(name, "Uint8Array", bytes(r));
    else console.log(name, typeof r, r !== null && typeof r === "object" ? JSON.stringify(r) : String(r));
  } catch (e) {
    console.log(name, "THROW", e.name, e.code, e.message);
  }
}

function enc(te) {
  T("typeof", () => typeof te);
  T("encoding", () => te.encoding);
  T("typeof encode", () => typeof te.encode);
  T("typeof decode", () => typeof te.decode);
  T("String", () => String(te));
  T("template", () => `${te}`);
  T("toString tag", () => Object.prototype.toString.call(te));
  T("JSON", () => JSON.stringify(te));
  T("JSON nested", () => JSON.stringify({ te, list: [te] }));
  T("truthy", () => !!te);
  T("encode", () => te.encode("héllo"));
  T("encode astral", () => te.encode("\u{1F600}"));
  T("encode empty", () => te.encode(""));
  T("encode none", () => te.encode());
  T("encode undefined", () => te.encode(undefined));
  T("encode null", () => te.encode(null));
  T("encode number", () => te.encode(12));
  T("encode object", () => te.encode({ toString() { return "xy"; } }));
  T("encode symbol", () => te.encode(Symbol("s")));
  T("encode result is a plain Uint8Array", () => String(te.encode("ab")));
  T("encodeInto", () => {
    const d = new Uint8Array(6);
    const r = te.encodeInto("aéb", d);
    return r.read + "/" + r.written + "/" + bytes(d);
  });
  T("encodeInto truncates whole characters", () => {
    const d = new Uint8Array(5);
    const r = te.encodeInto("a\u{1F600}b", d);
    return r.read + "/" + r.written + "/" + bytes(d);
  });
  T("encodeInto exact astral", () => {
    const d = new Uint8Array(4);
    const r = te.encodeInto("\u{1F600}", d);
    return r.read + "/" + r.written;
  });
  T("encodeInto empty destination", () => te.encodeInto("abc", new Uint8Array(0)));
  T("encodeInto a Buffer", () => te.encodeInto("abc", Buffer.alloc(2)));
  T("encodeInto result keys", () => Object.keys(te.encodeInto("ab", new Uint8Array(4))).join());
  T("encodeInto one argument", () => te.encodeInto("a"));
  T("encodeInto non-string source", () => te.encodeInto(5, new Uint8Array(4)));
  T("encodeInto array destination", () => te.encodeInto("a", [1]));
  T("encodeInto DataView destination", () => te.encodeInto("a", new DataView(new Uint8Array(2).buffer)));
  T("fatal on an encoder", () => te.fatal);
  T("decode is not an encoder method", () => te.decode(new Uint8Array(1)));
  T("write encoding", () => { te.encoding = "x"; return te.encoding; });
  T("method call keeps its receiver", () => te.encode("z"));
  T("has a prototype method", () => te.hasOwnProperty("encode"));
  T("valueOf", () => te.valueOf() === te);
  T("equals itself", () => te === te);
  T("a missing method", () => te.nope());
}

function dec(td) {
  T("typeof", () => typeof td);
  T("encoding", () => td.encoding);
  T("fatal", () => td.fatal);
  T("ignoreBOM", () => td.ignoreBOM);
  T("typeof decode", () => typeof td.decode);
  T("String", () => String(td));
  T("toString tag", () => Object.prototype.toString.call(td));
  T("JSON", () => JSON.stringify(td));
  T("decode", () => td.decode(new Uint8Array([104, 195, 169, 108, 108, 111])));
  T("decode none", () => td.decode());
  T("decode undefined", () => td.decode(undefined));
  T("decode empty", () => td.decode(new Uint8Array(0)));
  T("decode Buffer", () => td.decode(Buffer.from("héllo")));
  T("decode a DataView window", () => td.decode(new DataView(new Uint8Array([104, 105, 106]).buffer, 1, 2)));
  T("decode strips ONE leading BOM", () => JSON.stringify(td.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 65]))));
  T("decode replaces invalid bytes", () => JSON.stringify(td.decode(new Uint8Array([0xff, 0xc3, 0x28, 0xe2, 0x82]))));
  T("decode truncated sequence", () => JSON.stringify(td.decode(new Uint8Array([0xc3]))));
  T("decode astral", () => td.decode(new Uint8Array([0xf0, 0x9f, 0x98, 0x80])).length);
  T("decode null", () => td.decode(null));
  T("decode number", () => td.decode(5));
  T("decode string", () => td.decode("ab"));
  T("decode array", () => td.decode([1, 2]));
  T("decode object", () => td.decode({}));
  T("options number", () => td.decode(new Uint8Array(1), 5));
  T("options empty object", () => td.decode(new Uint8Array([65]), {}));
  T("options stream false", () => td.decode(new Uint8Array([65]), { stream: false }));
  T("options stream 0", () => td.decode(new Uint8Array([65]), { stream: 0 }));
  T("options other members are ignored", () => td.decode(new Uint8Array([65]), { fatal: true }));
  T("options undefined", () => td.decode(new Uint8Array([65]), undefined));
  T("options array", () => td.decode(new Uint8Array([65]), []));
  T("options win over input checks", () => td.decode(5, 5));
  T("write fatal", () => { td.fatal = true; return td.fatal; });
  T("encode is not a decoder method", () => td.encode("a"));
  T("a missing method", () => td.nope());
}

function kinds(x) {
  // the two codecs are distinguishable, and neither is a string
  return typeof x + ":" + Object.prototype.toString.call(x) + ":" + (typeof x.encode === "function" ? "enc" : "") + (typeof x.decode === "function" ? "dec" : "");
}

enc(new TextEncoder());
dec(new TextDecoder());
console.log(kinds(new TextEncoder()), kinds(new TextDecoder()), kinds("utf-8"));

// stored first, reached later through containers and closures
const holder = { e: new TextEncoder(), d: new TextDecoder() };
function viaHolder(h) { return h.d.decode(h.e.encode("round trip ü")); }
console.log(viaHolder(holder));
const list = [new TextEncoder(), new TextDecoder()];
function viaList(l) { return l.map((c) => typeof c.encode + typeof c.decode).join(","); }
console.log(viaList(list));

// the plain string "utf-8" is still just a string
function plain(s) { return typeof s + ":" + s + ":" + typeof s.encode; }
console.log(plain("utf-8"), plain(String(1)));

// the static spellings keep working next to the dynamic ones
const stat = new TextEncoder();
console.log(stat.encode("abc").length, new TextDecoder().decode(stat.encode("hé")));
