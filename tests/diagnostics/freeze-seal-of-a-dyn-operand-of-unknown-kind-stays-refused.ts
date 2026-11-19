// The integrity operations lower over a dyn operand only where its kind is known from where it was made (Object.create, and for freeze JSON.parse /
// structuredClone): a parameter or an `any` may hold a function, a class instance or a handle, which have no write table to guard, and a dyn array
// has no sealed form, so these stay refused at compile time.
function takesAny(x: any, y: unknown): void {
  Object.freeze(x);
  Object.seal(x);
  Object.preventExtensions(x);
  Object.freeze(y as object);
}
const arr: any = JSON.parse("[1, 2]");
Object.seal(arr);
Object.preventExtensions(arr);
takesAny({}, {});
