// util.format's %o is inspect with showHidden and depth 4: an array lists its non-enumerable `length`, nested arrays too, and a typed array
// lists BYTES_PER_ELEMENT, length, byteLength, byteOffset and buffer. %O stays at the defaults.
const a = [1, 2, 3];
console.log("%o", [1]);
console.log("%o", { a: 1, b: [1, 2] });
console.log("%o", new Map([[1, [2]]]));
console.log("%o|%o", a, "z");
console.log("%o", [[1], [2]]);
console.log("%o", [1.5, "s", true, null]);
console.log("%o", [1, [2, [3, [4, [5, [6]]]]]]);
console.log("%o", new Uint8Array(2));
console.log("%o|%o", new Float64Array([1.5]), [1]);
console.log("%O|%O", [1], { x: [1, 2] });
console.log("%o and %s and %d", [7], "str", 42);
console.error("%o", [1]);
