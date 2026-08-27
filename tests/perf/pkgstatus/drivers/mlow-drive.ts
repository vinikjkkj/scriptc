import { MLowCodec } from '../pkgs/voip/media/mlow-codec'
async function main(): Promise<void> {
    const c = await MLowCodec.create({ bitrate: 24000 })
    console.log('codec:', typeof c)
}
void main()
