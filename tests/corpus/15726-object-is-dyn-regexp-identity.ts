// Object.is over two dynamic (any) RegExp values is object identity (SameValue
// on a non-number object). Every evaluation of a regex literal makes a new
// RegExp object in JavaScript, so the same literal evaluated twice is two
// objects, the same object compared with itself is one object, two literals
// with the same source are two objects, and a RegExp built by the constructor is
// its own object. The Object.is answers below are the identity answers.
function mk(): any {
  return /a+/g;
}
function mkPlain(): any {
  return /a+/;
}
const r1: any = mk();
const r2: any = mk();
const alias: any = r1;
console.log("same literal twice", Object.is(r1, r2));
console.log("same object", Object.is(r1, r1), Object.is(r1, alias));
const x: any = /a+/;
const y: any = /a+/;
console.log("two literals, same source", Object.is(x, y), Object.is(x, x));
const z: any = mkPlain();
console.log("unflagged literal from a function", Object.is(z, mkPlain()), Object.is(z, z));
const ctor: any = new RegExp("a+");
console.log("constructed", Object.is(ctor, ctor), Object.is(ctor, x), Object.is(ctor, new RegExp("a+") as any));
const kept: any[] = [];
for (let i = 0; i < 3; i++) kept.push(mkPlain());
console.log("loop", Object.is(kept[0], kept[1]), Object.is(kept[2], kept[2]));
console.log("against scalars", Object.is(x, 1), Object.is(x, "/a+/"), Object.is(x, undefined));
