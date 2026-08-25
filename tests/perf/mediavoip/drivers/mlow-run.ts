import { MLowCodec } from '../pkgs/voip/media/mlow-codec.js'
async function main(): Promise<void> {
    const codec = await MLowCodec.create({ bitrate: 24000 })
    const pcm = new Float32Array(960)
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin(i / 12) * 0.5
    const packet = codec.encode(pcm)
    console.log('encoded bytes:', packet === null ? 'null' : packet.length)
}
main().then(() => console.log('MLOW: done')).catch((e) => console.log('MLOW: threw', e.message))
