// A checked-dynamic object carrying an explicit undefined member: the optional
// read answers undefined exactly as Node does, the key stays own but undefined.
const src: any = { a: undefined, b: 2 };
const T: { a?: number; b?: number } = src;
console.log(T.a, T.b, 'a' in T, JSON.stringify(T));
console.log(Object.keys(T), T);
