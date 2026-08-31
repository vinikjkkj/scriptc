interface E { f(a: Int32Array): void }
let x: Promise<E> | null = null
console.log(x === null ? 'null' : 'set')
