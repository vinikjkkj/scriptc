// TextDecoder flags on the utf-8 decoder: fatal validation with Node's TypeError, BOM stripping and
// ignoreBOM, the label spellings, and the undefined input. Stored and composed decoders both.
function show(label: string, e: unknown): void {
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code;
    console.log(label, e.name, code, e.message, e instanceof TypeError);
  } else {
    console.log(label, "not an error");
  }
}

const bomA = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
const plainDec = new TextDecoder();
console.log(plainDec.encoding, plainDec.fatal, plainDec.ignoreBOM);
console.log(JSON.stringify(plainDec.decode(bomA)));

const fatalDec = new TextDecoder("utf8", { fatal: true });
console.log(fatalDec.encoding, fatalDec.fatal, fatalDec.ignoreBOM);
console.log(JSON.stringify(fatalDec.decode(bomA)));
try {
  fatalDec.decode(new Uint8Array([0x41, 0xff]));
} catch (e) {
  show("stored fatal:", e);
}
try {
  fatalDec.decode(new Uint8Array([0xe2, 0x82]));
} catch (e) {
  show("truncated:", e);
}
try {
  new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xed, 0xa0, 0x80]));
} catch (e) {
  show("surrogate:", e);
}

const bomKeeper = new TextDecoder("utf-8", { ignoreBOM: true });
console.log(bomKeeper.fatal, bomKeeper.ignoreBOM);
console.log(JSON.stringify(bomKeeper.decode(bomA)));

const both = new TextDecoder("UTF-8", { fatal: true, ignoreBOM: true });
console.log(both.fatal, both.ignoreBOM);
console.log(JSON.stringify(both.decode(new Uint8Array([0xef, 0xbb, 0xbf]))));
console.log(JSON.stringify(new TextDecoder(" unicode-1-1-utf-8 ", { fatal: false }).decode(new Uint8Array([0x41, 0xff, 0x42]))));
console.log(JSON.stringify(new TextDecoder(undefined, { fatal: true }).decode(new Uint8Array([0x41, 0x42]))));
console.log(JSON.stringify(fatalDec.decode()));
console.log(JSON.stringify(fatalDec.decode(undefined)));
console.log(JSON.stringify(new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]))));
