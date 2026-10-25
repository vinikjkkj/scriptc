// wrong-type key, label and data arrive through untyped values: Node TypeError wording; an undefined label is absent
import * as crypto from "node:crypto";
const PEM = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCi0d0b90LLgCr+Qi3lyiWraLWW\njRLUdg9Attas3wVpKp7SdBA0dUemQHGqlfpa3IoovjW+pYDmGpU1B+dVLAsX+R/0\n0DbFCi0LldT2fT6SWAJecYm1X/NNSaGqVF88V3ig57F+7tMs0LuRa+DW3lcsQaZF\nD/rtMQC+ZvHhENg7JQIDAQAB\n-----END PUBLIC KEY-----\n";
function run(key, label, data) {
  try {
    return crypto.publicEncrypt({ key, oaepLabel: label }, data).length;
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
const n = JSON.parse('5');
const u = JSON.parse('null') ?? undefined;
console.log(run(n, undefined, Buffer.from('x')));
console.log(run(PEM, n, Buffer.from('x')));
console.log(run(PEM, undefined, n));
console.log(run(PEM, undefined, Buffer.from('x')));
console.log(u === undefined);
