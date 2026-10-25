// a message too long for OAEP and for PKCS#1 v1.5 on a 1024-bit key
import * as crypto from "node:crypto";
const PEM = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCi0d0b90LLgCr+Qi3lyiWraLWW\njRLUdg9Attas3wVpKp7SdBA0dUemQHGqlfpa3IoovjW+pYDmGpU1B+dVLAsX+R/0\n0DbFCi0LldT2fT6SWAJecYm1X/NNSaGqVF88V3ig57F+7tMs0LuRa+DW3lcsQaZF\nD/rtMQC+ZvHhENg7JQIDAQAB\n-----END PUBLIC KEY-----\n";
function oaep(n) {
  try {
    return crypto.publicEncrypt({ key: PEM, oaepHash: 'sha1' }, Buffer.alloc(n, 7)).length;
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
function pkcs1(n) {
  try {
    return crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.alloc(n, 7)).length;
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
console.log(oaep(86));
console.log(oaep(87));
console.log(pkcs1(117));
console.log(pkcs1(118));
