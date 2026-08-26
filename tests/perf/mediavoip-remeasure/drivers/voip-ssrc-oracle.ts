import { generateSecureSsrc } from '../pkgs/voip/crypto/ssrc.js'
const cases: [string, string, number][] = [['CALLID1234567890','12345@lid',0],['CALLID1234567890','12345@lid',1],['CALLID1234567890','12345@lid',2],['OTHERCALLID00001','12345@lid',0],['CALLID1234567890','99999@lid',0]]
for (const [a,b,c] of cases) console.log(a + ' ' + b + ' ' + c + ' => ' + generateSecureSsrc(a,b,c))
