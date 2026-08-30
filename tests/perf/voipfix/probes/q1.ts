interface E { f(a: Int16Array): void }
let x: Promise<E> | null = null
console.log(x === null ? 'null' : 'set')
