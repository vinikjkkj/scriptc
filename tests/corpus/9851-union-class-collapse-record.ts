// A union of two class instances flowing into one record slot: each instance
// projects into the shape by the same field copy a lone instance uses.
type MessageName = 'parseComplete' | 'notice' | 'error';
interface BackendMessage {
  length: number;
  name: string;
}
class DatabaseError {
  readonly length: number;
  readonly name: MessageName;
  constructor(length: number, name: MessageName) {
    this.length = length;
    this.name = name;
  }
}
class NoticeMessage {
  readonly length: number;
  readonly message: string | undefined;
  readonly name = 'notice';
  constructor(length: number, message: string | undefined) {
    this.length = length;
    this.message = message;
  }
}
function parse(k: number): DatabaseError | NoticeMessage {
  if (k === 0) return new NoticeMessage(3, 'hi');
  return new DatabaseError(4, 'error');
}
function go(k: number): void {
  let message: BackendMessage;
  switch (k) {
    case 0:
      message = parse(0);
      break;
    default:
      message = new DatabaseError(9, 'parseComplete');
  }
  console.log(message.length, message.name);
}
go(0);
go(1);
