import { XSub } from './pgbasemodB/sub'

declare const hh: { connect(): unknown }
const s = new XSub(hh, 'x')
const w = s.who()
console.log('a=' + w)
