'use strict'
// a dyn source carrying a hidden data and an accessor property
const src: any = JSON.parse('{"x":1}');
Object.defineProperty(src, 'h', { value: 'hid', enumerable: false });
Object.defineProperty(src, 'g', { get() { return 'got'; }, configurable: true, enumerable: false });
const cl: any = Object.defineProperties(Object.create(Object.getPrototypeOf(src)), Object.getOwnPropertyDescriptors(src));
console.log(cl.x, cl.h, cl.g);
console.log(JSON.stringify(cl));
console.log(cl);
