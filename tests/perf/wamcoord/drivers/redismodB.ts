import { RSub } from './rmodB/sub'

declare const rr: { pipeline(): unknown }
const s = new RSub(rr, 'x')
const w = s.who()
console.log('a=' + w)
