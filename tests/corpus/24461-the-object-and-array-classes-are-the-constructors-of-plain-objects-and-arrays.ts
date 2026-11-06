/* eslint-disable @typescript-eslint/no-explicit-any -- the row reads members off untyped values on purpose */
// The Object and Array classes are the same function objects a plain object's and an array's constructor answers.
const obj: any = { a: 1 };
const arr: any = [1, 2];
const buf: any = Buffer.from([1]);
console.log(obj.constructor === Object, arr.constructor === Array, obj.constructor === Array, arr.constructor === Object, buf.constructor === Object);
console.log(obj.constructor.name, arr.constructor.name, typeof obj.constructor, typeof arr.constructor);
console.log(Object === Object, Array === Array, Object === (Array as any), obj.constructor === arr.constructor);
