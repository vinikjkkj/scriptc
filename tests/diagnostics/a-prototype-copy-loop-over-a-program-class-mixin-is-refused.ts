// The ioredis applyMixin helper, applied to a program class instead of the runtime EventEmitter. Node copies every own member of
// Mixin.prototype (methods, accessors, and 'constructor') onto Base.prototype; the compiler models only the EventEmitter graft, and a
// copy it cannot install is refused at compile time rather than compiled to a program whose Base has no such members.
function applyMixin(derivedConstructor: any, mixinConstructor: any): void {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name)!);
  });
}
class Mixin {
  hello(): string {
    return "hi";
  }
}
class Base {
  name = "base";
}
applyMixin(Base, Mixin);
console.log((new Base() as any).hello());
