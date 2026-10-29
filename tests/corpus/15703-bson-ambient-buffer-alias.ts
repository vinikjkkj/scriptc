// bson shape: `declare const Buffer: NodeJsBufferConstructor` shadows the global
// Buffer in a module, and the NodeJsBuffer alias (a byte view intersected with
// Buffer's own method typings) is the return type of the static constructors.
// The calls must reach the native Buffer: allocation lengths, fills, Buffer.isBuffer
// and instanceof on the results, concat, byteLength, from() over each input kind.
export {};
type NodeJsEncoding = 'base64' | 'hex' | 'utf8' | 'binary';
type NodeJsBuffer = ArrayBufferView &
  Uint8Array & {
    write(string: string, offset: number, length: undefined, encoding: 'utf8'): number;
    copy(target: Uint8Array, targetStart: number, sourceStart: number, sourceEnd: number): number;
    toString: (this: Uint8Array, encoding: NodeJsEncoding, start?: number, end?: number) => string;
    equals: (this: Uint8Array, other: Uint8Array) => boolean;
    swap32: (this: NodeJsBuffer) => NodeJsBuffer;
    compare: (this: Uint8Array, other: Uint8Array) => -1 | 0 | 1;
  };
type NodeJsBufferConstructor = Omit<Uint8ArrayConstructor, 'from'> & {
  alloc: (size: number) => NodeJsBuffer;
  allocUnsafe: (size: number) => NodeJsBuffer;
  from(array: number[]): NodeJsBuffer;
  from(array: Uint8Array): NodeJsBuffer;
  from(base64: string, encoding: NodeJsEncoding): NodeJsBuffer;
  byteLength(input: string, encoding: 'utf8'): number;
  isBuffer(value: unknown): value is NodeJsBuffer;
  concat(list: Uint8Array[]): NodeJsBuffer;
};
declare const Buffer: NodeJsBufferConstructor;

function make(n: number): NodeJsBuffer {
  return Buffer.alloc(n);
}
function unsafe(n: number): NodeJsBuffer {
  return Buffer.allocUnsafe(n);
}
function fromArray(xs: number[]): NodeJsBuffer {
  return Buffer.from(xs);
}
function fromB64(s: string): NodeJsBuffer {
  return Buffer.from(s, 'base64');
}
function joined(parts: Uint8Array[]): NodeJsBuffer {
  return Buffer.concat(parts);
}

const z = make(4);
console.log("alloc", z.length, z[0], z[3], Buffer.isBuffer(z), z instanceof Uint8Array);
const u = unsafe(2);
console.log("unsafe", u.length, Buffer.isBuffer(u));
const f = fromArray([10, 20, 30]);
console.log("from", f.length, f.toString('hex'), Buffer.isBuffer(f));
console.log("b64", fromB64("aGk=").toString('utf8'), fromB64("aGk=").length);
const j = joined([new Uint8Array([1]), new Uint8Array([2, 3])]);
console.log("concat", j.toString('hex'), j.length, Buffer.isBuffer(j));
console.log("byteLength", Buffer.byteLength("é", 'utf8'), Buffer.byteLength("abc", 'utf8'));
const s = fromArray([1, 2, 3, 4]);
console.log("swap32", s.swap32().toString('hex'), s.equals(fromArray([4, 3, 2, 1])));
console.log("compare", s.compare(fromArray([4, 3, 2, 1])), s.compare(s));
const sink = make(6);
console.log("copy", s.copy(sink, 1, 0, 4), sink.toString('hex'));
console.log("write", sink.write("hé", 0, undefined, 'utf8'), sink.toString('hex'));
