// A generic class whose base names its own type parameter (a split family) referenced with an argument that has no static type (an `any` argument is built as the checked-dynamic type, so this one uses Iterable<any>): the diagnostic names the class instance and the reason, not only that the member 'does not compile'.
class Emitter<E> {
  handlers: E | undefined = undefined;
}
class Cursor<T = any, E = {}> extends Emitter<E> {
  items: T[] = [];
}
interface Priv {
  cursors: Set<Cursor<Iterable<any>, {}>>;
}
const p: Priv = { cursors: new Set() };
console.log(p.cursors.size);
