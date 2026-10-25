// A class extending Error with extra fields: thrown and caught, stored in a
// union record slot, printed. Covers name/message presence, instanceof Error
// and the subclass, String(e), and the empty-message toString rule.
type MessageName = 'parseComplete' | 'notice' | 'error';
interface BackendMessage {
  name: MessageName;
  length: number;
}
class DatabaseError extends Error {
  readonly length: number;
  readonly name: MessageName;
  readonly code: string;
  constructor(message: string, length: number, code: string) {
    super(message);
    this.length = length;
    this.name = 'error';
    this.code = code;
  }
}
class NoticeMessage {
  readonly length: number;
  readonly name = 'notice';
  readonly text: string;
  constructor(length: number, text: string) {
    this.length = length;
    this.text = text;
  }
}
function pick(k: number): BackendMessage {
  if (k === 0) return new NoticeMessage(3, 'hi');
  return new DatabaseError('boom', 4, 'E42');
}
function describe(e: unknown): string {
  if (e instanceof DatabaseError) {
    return 'db ' + e.code + ' ' + String(e) + ' ' + e.length;
  }
  if (e instanceof Error) return 'error ' + String(e);
  return 'other';
}
for (let k = 0; k < 2; k++) {
  const rec: BackendMessage = pick(k);
  console.log(rec.length, rec.name);
}
try {
  throw new DatabaseError('boom', 9, 'E9');
} catch (e) {
  console.log(e instanceof DatabaseError, e instanceof Error);
  console.log(describe(new DatabaseError('boom', 9, 'E9')));
  console.log(`${e}`);
  console.log((e as DatabaseError).message, (e as DatabaseError).name);
  console.log(typeof (e as DatabaseError).stack);
}
console.log(String(new DatabaseError('', 1, 'X')));
console.log(describe(new Error('plain')));
