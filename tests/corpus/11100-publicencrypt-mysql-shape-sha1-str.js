// the mysql2 caching_sha2 shape: untyped key (PEM string), sha1 OAEP options object
import * as crypto from "node:crypto";
function xorRotating(a, seed) {
  const result = Buffer.allocUnsafe(a.length);
  const seedLen = seed.length;
  for (let i = 0; i < a.length; i++) result[i] = a[i] ^ seed[i % seedLen];
  return result;
}
function encrypt(password, scramble, key) {
  const stage1 = xorRotating(Buffer.from(`${password}\0`, 'utf8'), scramble);
  return crypto.publicEncrypt({ key, oaepHash: 'sha1', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, stage1);
}
const PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz9gdMl/fVTqIn7Vt5t10\nd0zMCaOTpo5IKSg08ur4vclYtjwUnC7u5JD8gTHc2j5UNoioMsx2cUpZ5h25rKmG\n6KzI5UWUhs02jLwoJUytCPA3wNTwSCddziV3lxSfBG39rHIGtWnwDIPhYvg/Mxlx\nBTKna115gNYgVXGyOSs0TqCGB756Um1f6KxaydEFRFQQuE+vj+8R8T+uZSGVPSQf\nCnsX7NNeFsg/HUK5Ck/Gi2iPSvOID+Yx2FmXEI81/ZufjXIBibLgJh1gAeqk5Luz\nRnmwgXhEoJmNnKpaBL20/Wnw06ltQenxlDvPUO2a+ZK9ga5bqHWV5w4lu/Vjd9/h\nxwIDAQAB\n-----END PUBLIC KEY-----\n";
const scramble = Buffer.from('0123456789abcdefghij');
const out = encrypt('secret', scramble, PEM);
console.log(Buffer.isBuffer(out), out.length);
