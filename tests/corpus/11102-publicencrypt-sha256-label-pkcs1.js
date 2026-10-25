// sha256 OAEP with an oaepLabel, PKCS#1 v1.5 and NO_PADDING lengths; NO_PADDING is raw RSA and prints its hex
import * as crypto from "node:crypto";
const PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz9gdMl/fVTqIn7Vt5t10\nd0zMCaOTpo5IKSg08ur4vclYtjwUnC7u5JD8gTHc2j5UNoioMsx2cUpZ5h25rKmG\n6KzI5UWUhs02jLwoJUytCPA3wNTwSCddziV3lxSfBG39rHIGtWnwDIPhYvg/Mxlx\nBTKna115gNYgVXGyOSs0TqCGB756Um1f6KxaydEFRFQQuE+vj+8R8T+uZSGVPSQf\nCnsX7NNeFsg/HUK5Ck/Gi2iPSvOID+Yx2FmXEI81/ZufjXIBibLgJh1gAeqk5Luz\nRnmwgXhEoJmNnKpaBL20/Wnw06ltQenxlDvPUO2a+ZK9ga5bqHWV5w4lu/Vjd9/h\nxwIDAQAB\n-----END PUBLIC KEY-----\n";
const data = Buffer.from('label check');
const a = crypto.publicEncrypt({ key: PEM, oaepHash: 'sha256', oaepLabel: Buffer.from('lbl') }, data);
const b = crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_PKCS1_PADDING }, data);
const raw = Buffer.alloc(256, 0x01);
const c = crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_NO_PADDING }, raw);
console.log(a.length, b.length, c.length);
console.log(c.toString('hex'));
