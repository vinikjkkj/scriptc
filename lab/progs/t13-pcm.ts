// The shape zapo's audio path actually has: an Int16Array of PCM samples
// walked, scaled, and handed on as bytes.
function toPcm(samples: number[]): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    let v = Math.round(samples[i]! * 32767)
    if (v > 32767) v = 32767
    if (v < -32768) v = -32768
    out[i] = v
  }
  return out
}
const pcm = toPcm([0, 0.5, -0.5, 1, -1, 1.5, -1.5])
for (let i = 0; i < pcm.length; i++) console.log('pcm', i, pcm[i])
const raw = new Uint8Array(pcm.buffer)
let sum = 0
for (let i = 0; i < raw.length; i++) sum += raw[i]!
console.log('bytes', raw.length, 'sum', sum)
