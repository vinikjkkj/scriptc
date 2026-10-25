// RSA_NO_PADDING: a short input, a long input, and a value at or above the modulus
import * as crypto from "node:crypto";
const PEM = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCi0d0b90LLgCr+Qi3lyiWraLWW\njRLUdg9Attas3wVpKp7SdBA0dUemQHGqlfpa3IoovjW+pYDmGpU1B+dVLAsX+R/0\n0DbFCi0LldT2fT6SWAJecYm1X/NNSaGqVF88V3ig57F+7tMs0LuRa+DW3lcsQaZF\nD/rtMQC+ZvHhENg7JQIDAQAB\n-----END PUBLIC KEY-----\n";
function short() {
  try {
    return crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_NO_PADDING }, Buffer.alloc(3, 1)).toString('hex');
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
function long() {
  try {
    return crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_NO_PADDING }, Buffer.alloc(200, 1)).toString('hex');
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
function atModulus() {
  try {
    return crypto.publicEncrypt({ key: PEM, padding: crypto.constants.RSA_NO_PADDING }, Buffer.alloc(128, 255)).toString('hex');
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
console.log(short());
console.log(long());
console.log(atModulus());
