/** The string members whose receiver may be the ABSENT string in a module that can hold one (IrModule.absentStrings): the JS member each
 * strIntrinsic method spells, for Node's `Cannot read properties of undefined (reading '<member>')`. Methods not listed are internal spellings. */
const ABSENT_RECV_MEMBER: Partial<Record<string, string>> = {
  length: "length", charCodeAt: "charCodeAt", charAt: "charAt", indexOf: "indexOf", includes: "includes", startsWith: "startsWith",
  endsWith: "endsWith", slice: "slice", substring: "substring", substr: "substr", repeat: "repeat", trim: "trim", trimStart: "trimStart",
  trimEnd: "trimEnd", split: "split", padStart: "padStart", padEnd: "padEnd", toLowerCase: "toLowerCase", toUpperCase: "toUpperCase",
  NFC: "normalize", normalize: "normalize", toLocaleLowerCase: "toLocaleLowerCase", toLocaleUpperCase: "toLocaleUpperCase",
  localeCompareMode: "localeCompare", localeCompare: "localeCompare", isWellFormed: "isWellFormed", toWellFormed: "toWellFormed", cpAt: "codePointAt",
};
export function absentRecvMember(method: string): string | undefined {
  return ABSENT_RECV_MEMBER[method];
}

/** The regexIntrinsic methods whose STRING receiver is a member use (Node throws on the absent string), and the ones that coerce it to the text
 * "undefined" (RegExp.prototype.exec / test take the subject as an argument: ToString(undefined)). */
const ABSENT_RECV_REGEX = new Set(["match", "matchAll", "search", "replace", "replaceAll", "split"]);
export function absentRegexRecvMember(method: string): string | undefined {
  return ABSENT_RECV_REGEX.has(method) ? method : undefined;
}
