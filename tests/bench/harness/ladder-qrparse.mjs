/* ladder-qrparse.mjs: inline parsePairingQrString (zapobench).
 * messaging.bench.ts imports it from ../src/protocol/auth/pair-device, which is FAKE-SERVER source (packages/fake-server/src);
 * that import drags fake-server/src/transport/{util,crypto,codec}.ts into the compiled client graph. The task forbids fake-server
 * code in the client graph, so the function (a pure 5-part split + decodeBase64Url, verbatim body) is declared locally and
 * decodeBase64Url is taken from zapo's own `zapo-js/util`. Bench semantics unchanged. argv[2] = bench dir. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const f = join(process.argv[2], 'messaging.bench.ts'); const t = readFileSync(f, 'utf8')
const imp = "import { parsePairingQrString } from '../src/protocol/auth/pair-device'"
if (!t.includes(imp)) { console.error('import not found'); process.exit(4) }
const lines = t.split('\n'); const i = lines.indexOf(imp); if (i < 0) process.exit(5)
const fn = `
// zapobench: local copy of fake-server/src/protocol/auth/pair-device.ts parsePairingQrString (verbatim body), so no fake-server source is compiled.
interface ParsedPairingQr {
    readonly ref: string
    readonly noisePublicKey: Uint8Array
    readonly identityPublicKey: Uint8Array
    readonly advSecretKey: Uint8Array
    readonly platform: string
}
function parsePairingQrString(qr: string): ParsedPairingQr {
    const parts = qr.split(',')
    if (parts.length < 5) {
        throw new Error(\`pairing qr must have 5 comma-separated parts, got \${parts.length}\`)
    }
    const platform = parts[parts.length - 1]
    const advSecretB64 = parts[parts.length - 2]
    const identityPubB64 = parts[parts.length - 3]
    const noisePubB64 = parts[parts.length - 4]
    const ref = parts.slice(0, parts.length - 4).join(',')
    return {
        ref,
        noisePublicKey: decodeBase64Url(noisePubB64, 'qr.noisePublicKey'),
        identityPublicKey: decodeBase64Url(identityPubB64, 'qr.identityPublicKey'),
        advSecretKey: decodeBase64Url(advSecretB64, 'qr.advSecretKey'),
        platform
    }
}`
lines.splice(i, 1, "import { decodeBase64Url } from 'zapo-js/util'")
// insert the function after the import block: before the first line that starts a non-import top-level statement after line i
let j = i + 1; while (j < lines.length && (lines[j].startsWith('import ') || lines[j].trim() === '' || lines[j].startsWith(' ') || lines[j].startsWith('}') )) j++
lines.splice(j, 0, fn)
const out = lines.join('\n')
if (out.includes(imp) || !out.includes('function parsePairingQrString')) { console.error('self-test failed'); process.exit(6) }
writeFileSync(f, out); console.log('inlined parsePairingQrString')
