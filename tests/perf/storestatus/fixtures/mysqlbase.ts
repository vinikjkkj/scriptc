import { XSub } from './mysqlbasemod/sub'

declare const hh: import('mysql2/promise').Pool
const s = new XSub(hh, 'x')
const w = s.who()
console.log('a=' + w)
