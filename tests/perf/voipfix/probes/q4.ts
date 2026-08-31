interface E { f(a: Uint8Array): void }
let x: Promise<E> | null = null
console.log(x === null ? 'null' : 'set')
