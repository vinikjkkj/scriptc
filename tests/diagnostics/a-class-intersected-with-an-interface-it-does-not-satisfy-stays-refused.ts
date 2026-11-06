/* A class instance intersected with an interface whose member the class lacks is not the class: the value would need a shape that is
 * neither, so the intersection keeps its refusal (SC2008). The satisfied case (Readable & AsyncIterable<T>) compiles: tests/corpus/24330. */
interface Closable {
  close(): void;
}
class Plain {
  n = 1;
}
function lacks(): Plain & Closable {
  return { n: 1, close() {} } as Plain & Closable;
}
console.log(lacks().n);
