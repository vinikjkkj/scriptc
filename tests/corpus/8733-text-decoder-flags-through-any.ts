// A flagged decoder that crosses into an untyped slot keeps its flags: fatal validation and BOM
// handling happen on the dynamic decode path too.
function show(label: string, e: unknown): void {
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code;
    console.log(label, e.name, code, e.message);
  }
}
const dec: any = new TextDecoder("utf-8", { fatal: true });
console.log(dec.encoding, dec.fatal, dec.ignoreBOM);
try {
  dec.decode(new Uint8Array([0x80]));
} catch (e) {
  show("dyn fatal:", e);
}
console.log(JSON.stringify(dec.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x42]))));
const keep: any = new TextDecoder("utf-8", { ignoreBOM: true });
console.log(keep.fatal, keep.ignoreBOM, JSON.stringify(keep.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x42]))));
const plain: any = new TextDecoder();
console.log(plain.fatal, plain.ignoreBOM, JSON.stringify(plain.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x42]))));
