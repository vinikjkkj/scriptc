// The boundary worth knowing: an ambient declaration whose global IS defined at
// run time. Node prints the replaced string. If the compiled binary throws
// ReferenceError here, the undefined-global lowering is unconditional and that
// IS a divergence -- a different defect from the one being investigated.
declare const injected: string
;(globalThis as unknown as { injected: string }).injected = 'u@v'
console.log('a=' + injected)
