// node:stream under REAL @types/node. Every runtime stream class, the
// pipe chain, `for await`, destroy(), and the completion callbacks whose
// `data` parameter @types/node types `any` (the shipped fallback types it
// `Buffer | string`) — the shape that used to reach the backend as the
// "stream done data param not a union" emitter bug.
//
// The same program under the shipped fallback declarations is
// tests/corpus/3181-stream-done-callback-tuples.ts; both must print the
// same thing, and both must match Node.
import { Duplex, PassThrough, Readable, Transform, Writable } from "node:stream";

async function main(): Promise<void> {
    const seen: string[] = []

    // A Transform whose completion callback carries a data argument.
    const upper = new Transform({
        transform(chunk: Buffer, _enc: string, cb) {
            cb(null, Buffer.from(chunk.toString('utf8').toUpperCase()))
        },
        flush(cb) {
            cb(null, Buffer.from('!'))
        }
    })

    const pt = new PassThrough()
    const sink = new Writable({
        write(chunk: Buffer, _enc: string, cb) {
            seen.push(chunk.toString('utf8'))
            cb()
        },
        final(cb) {
            seen.push('<final>')
            cb()
        }
    })

    const src = new Readable({
        read() {
            this.push(Buffer.from('ab'))
            this.push(Buffer.from('cd'))
            this.push(null)
        }
    })

    src.pipe(upper).pipe(pt).pipe(sink)
    await new Promise<void>((resolve) => sink.on('finish', () => resolve()))
    console.log('piped:', seen.join('|'))

    // for await over a Readable — the async-iteration path that used to
    // report SC1070 whenever @types/node was the declaration source.
    const counted = new Readable({
        read() {
            this.push(Buffer.from('xyz'))
            this.push(null)
        }
    })
    let total = 0
    for await (const chunk of counted) {
        total += (chunk as Buffer).byteLength
    }
    console.log('for-await bytes:', total)

    // destroy(), with and without an error, and the state properties.
    const doomed = new Readable({ read() {} })
    console.log('before:', doomed.destroyed)
    doomed.destroy()
    console.log('after:', doomed.destroyed, doomed.errored === null ? 'clean' : 'errored')

    const errored = new Readable({ read() {} })
    errored.on('error', (e: Error) => console.log('error:', e.message))
    errored.destroy(new Error('boom'))

    // Duplex: both halves off one value.
    const dup = new Duplex({
        read() {
            this.push(null)
        },
        write(chunk: Buffer, _enc: string, cb) {
            console.log('duplex wrote:', chunk.byteLength)
            cb()
        }
    })
    dup.write(Buffer.from('hello'))
    dup.end()
    console.log('duplex readable/writable:', dup.readable, dup.writable)
}

void main()
