// A method type that declares a `this: T` receiver (node:stream's TransformOptions) maps: the receiver annotation is not an argument.
import type { TransformOptions } from 'stream'
type StreamOptions = TransformOptions & { mode: 'text' | 'binary' }
class Parser {
  private mode: 'text' | 'binary'
  constructor(opts?: StreamOptions) {
    if (opts?.mode === 'binary') throw new Error('binary mode not supported')
    this.mode = opts?.mode || 'text'
  }
  get m() { return this.mode }
}
console.log(new Parser().m)
try { new Parser({ mode: 'binary' }) } catch (e) { console.log((e as Error).message) }
console.log(new Parser({ mode: 'text', objectMode: true }).m)
class X { v = 10 }
interface O { hook?(this: X, n: number): number; plain?(n: number): number }
const o: O = { plain(n) { return n * 2 } };
function run(opts?: O) { return opts && opts.plain ? opts.plain(3) : -1 }
console.log(run(), run(o), o.hook === undefined)
