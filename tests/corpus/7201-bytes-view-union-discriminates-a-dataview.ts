// The union zapo's own `toBytesView` takes, verbatim:
//
//     function toBytesView(value: Uint8Array | ArrayBuffer | ArrayBufferView)
//
// Three type names, TWO IR arms -- Uint8Array and ArrayBufferView collapse
// into the same bytes<u8> arm, and ArrayBuffer keeps its own. So the union
// TAG is necessary and not sufficient for `instanceof Uint8Array`: the u8
// arm holds Uint8Arrays, Buffers and DataViews alike, and only the first
// two are instances of Uint8Array in Node.
//
// This is the shape the defect was found in, and it is the shape that
// matters, because the ArrayBufferView arm is exactly what makes a DataView
// a CONTRACTUALLY VALID argument to these functions.
function classify(value: Uint8Array | ArrayBuffer | ArrayBufferView): string {
  if (value instanceof Uint8Array) return `u8:${value.length}`;
  if (value instanceof ArrayBuffer) return `ab:${value.byteLength}`;
  return `view:${value.byteLength}`;
}

// No free-standing ArrayBuffer VALUE exists in this tier, so the `ab:` arm
// is exercised by the union's shape rather than by a call -- the arm is
// what makes this a two-arm union in the first place.
const owner = new Uint8Array([10, 20, 30, 40]);
console.log(classify(owner));
console.log(classify(new DataView(owner.buffer, 1, 2)));
console.log(classify(Buffer.from([1, 2, 3, 4, 5])));
console.log(classify(owner.subarray(1, 3)));

// The two-arm dispatch a WebSocket message handler writes, with the
// DataView arm the union admits but nobody remembers to think about.
function firstByte(data: Uint8Array | DataView): number {
  return data instanceof Uint8Array ? data[0]! : data.getUint8(0);
}
console.log(firstByte(owner), firstByte(new DataView(owner.buffer, 2, 2)));
