// The `am I running on Node?` probe, written the way a library that must
// also compile for a browser writes it — reaching `process` through a
// CAST over globalThis, snapshotting it into a local, and asking through
// an OPTIONAL CHAIN:
//
//     const p = (globalThis as typeof globalThis & {
//         process?: { versions?: { node?: string } }
//     }).process
//     if (typeof p?.versions?.node === 'string') return 'node'
//
// Three separate recognitions have to line up for that to be the process
// global. The receiver is behind an `as`, which changes only the STATIC
// view — the object is still the one global, so stdlibGlobalNameOf peels
// it (the member check is unchanged, so a cast that invents a member the
// standard library does not declare still resolves to no global). The
// snapshot is then pure alias plumbing, the `const process =
// globalThis.process` rule. And the read is optional at both links,
// neither of which can short-circuit: the process global is always
// present and its `versions` is always an object.
//
// The ANSWER is pre-decided and unchanged: process.versions.node reports
// the runtime's Node COMPATIBILITY TARGET (SEMANTICS.md divergence 60),
// so — exactly as 1531-process-arch-versions does — what is pinned here
// is the derived facts a probe actually uses, never the raw string.

type SocketRuntime = 'browser' | 'node'

function resolveSocketRuntime(): SocketRuntime {
    const maybeNodeProcess = (
        globalThis as typeof globalThis & {
            process?: {
                versions?: {
                    node?: string
                }
            }
        }
    ).process
    if (typeof maybeNodeProcess?.versions?.node === 'string') {
        return 'node'
    }
    return 'browser'
}

console.log(resolveSocketRuntime())

// The same read without the snapshot, and without the cast: every
// spelling of the chain names one value.
const direct = globalThis.process?.versions?.node
const inline = (
    globalThis as typeof globalThis & { process?: { versions?: { node?: string } } }
).process?.versions?.node
const plain = process.versions.node
const midOptional = process?.versions.node

console.log(typeof direct, typeof inline, typeof plain, typeof midOptional)
console.log(direct === plain, inline === plain, midOptional === plain)
console.log(plain.split('.').length)
console.log(parseInt(plain.split('.')[0]!, 10) >= 24)

// What the peel must still REFUSE cannot appear in a corpus program,
// because a corpus program has to build — each of these keeps its fence,
// which is the point:
//   (globalThis as typeof globalThis & { notAGlobal?: {…} }).notAGlobal
//       -> SC2020 'globalThis'         the peel invents no member; the
//                                      name must resolve to a symbol the
//                                      standard library declares
//   process.versions.v8
//       -> SC2020 'process.versions'   components that are not linked are
//                                      not answered with a made-up string
//
// What CAN be pinned here is the other half of the same guarantee: a
// receiver that merely looks like the global keeps its own value, in the
// same program that reads the real one.
const impostor = { process: { versions: { node: '0.0.0-fake' } } }
console.log((impostor as typeof impostor).process?.versions?.node)

function shadowed(): string {
    const process = { versions: { node: '0.0.0-shadow' } }
    return process.versions.node
}
console.log(shadowed())
