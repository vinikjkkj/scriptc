import { XSub } from './pgbasemod/sub'

declare const hh: import('pg').Pool
const s = new XSub(hh, 'x')
const w = s.who()
console.log('a=' + w)
