const Codes = { 1062: "ER_DUP_ENTRY" };
export function asError(code, message) {
  const err = new Error(message);
  err.code = Codes[code];
  err.errno = code;
  err.sqlMessage = message;
  return err;
}
