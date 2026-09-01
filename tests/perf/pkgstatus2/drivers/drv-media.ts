import { createMediaProcessor } from '../pkgs/media-utils/index'
const p = createMediaProcessor({ imageThumbQuality: 55, waveformPoints: 64 })
console.log('1 image:', typeof p.generateImageThumbnail)
console.log('2 probe:', typeof p.probeMedia)
console.log('3 waveform:', typeof p.computeWaveform)
console.log('4 sticker:', typeof p.generateStickerThumbnail)
