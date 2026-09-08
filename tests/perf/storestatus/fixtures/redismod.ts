import { RSub } from './rmod/sub'

declare const rr: import('ioredis').default
const s = new RSub(rr, 'x')
const w = s.who()
console.log('a=' + w)
