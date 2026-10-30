// A module that redeclares the codec globals with its own types (the shape npm packages ship): the
// declare const emits nothing, so the references are the real TextEncoder and TextDecoder.
type TextDecoder = {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: Uint8Array): string;
};
type TextDecoderConstructor = {
  new (label: "utf8", options: { fatal: boolean; ignoreBOM?: boolean }): TextDecoder;
};
type TextEncoder = {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
};
type TextEncoderConstructor = {
  new (): TextEncoder;
};
declare const TextDecoder: TextDecoderConstructor;
declare const TextEncoder: TextEncoderConstructor;

let TextDecoderFatal: TextDecoder;
let TextDecoderNonFatal: TextDecoder;

function parseUtf8(buffer: Uint8Array, start: number, end: number, fatal: boolean): string {
  if (fatal) {
    TextDecoderFatal ??= new TextDecoder("utf8", { fatal: true });
    try {
      return TextDecoderFatal.decode(buffer.subarray(start, end));
    } catch (cause) {
      throw new Error("Invalid UTF-8 string in BSON document");
    }
  }
  TextDecoderNonFatal ??= new TextDecoder("utf8", { fatal: false });
  return TextDecoderNonFatal.decode(buffer.subarray(start, end));
}

function fromUTF8(utf8: string): Uint8Array {
  return new TextEncoder().encode(utf8);
}
function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).byteLength;
}
function encodeUTF8Into(uint8array: Uint8Array, source: string, byteOffset: number): number {
  const bytes = new TextEncoder().encode(source);
  uint8array.set(bytes, byteOffset);
  return bytes.byteLength;
}

const encoded = fromUTF8("héllo €");
console.log(encoded.length, utf8ByteLength("héllo €"));
const out = new Uint8Array(12);
console.log(encodeUTF8Into(out, "hé", 1), out[1], out[2], out[3]);
console.log(parseUtf8(encoded, 0, encoded.length, false));
console.log(parseUtf8(encoded, 0, encoded.length, true));
try {
  parseUtf8(new Uint8Array([0xff, 0x41]), 0, 2, true);
} catch (e) {
  console.log("caught", (e as Error).message);
}
export {};
