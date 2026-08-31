interface E { f(a: Uint16Array): void }
let x: Promise<E> | null = null
console.log(x === null ? 'null' : 'set')
