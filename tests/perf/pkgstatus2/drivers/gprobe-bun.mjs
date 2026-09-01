const names = ['Bun', 'Deno', 'window', 'document', 'fetch', 'navigator', 'Blob', 'process', 'WorkerGlobalScope']
const read = (where) => names.map((n) => `${n} own=${Object.prototype.hasOwnProperty.call(globalThis, n)} typeof=${typeof globalThis[n]}`).map((s) => `${where} ${s}`).join('\n')
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
if (isMainThread) {
    console.log(read('main'))
    const w = new Worker(new URL(import.meta.url))
    w.on('message', (m) => { console.log(m); w.terminate() })
} else {
    parentPort.postMessage(read('worker'))
}
