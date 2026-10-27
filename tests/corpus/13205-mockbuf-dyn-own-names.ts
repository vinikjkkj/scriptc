// Own named properties on a bytes value through the dynamic path: a non-index
// write stores in the value's own table, reads and membership see it, Object.keys
// lists it after the indices, a method override is called instead of the native
// one (on that value only), and delete restores the prototype.
const b: any = Buffer.alloc(2);
b.foo = 7;
console.log(b.foo, 'foo' in b, Object.prototype.hasOwnProperty.call(b, 'foo'));
console.log(Object.keys(b).join(','));
b.readUInt8 = function () { return 42; };
console.log(b.readUInt8(0), Object.keys(b).join(','));
const c: any = Buffer.alloc(2);
console.log(c.length, "foo" in c, Object.keys(c).join(","));
delete b.foo;
console.log(b.foo, 'foo' in b, Object.keys(b).join(','));
