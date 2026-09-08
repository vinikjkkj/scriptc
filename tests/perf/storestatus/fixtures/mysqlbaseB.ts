import { XSub } from './mysqlbasemodB/sub'

declare const hh: { query(): unknown }
const s = new XSub(hh, 'x')
const w = s.who()
console.log('a=' + w)
