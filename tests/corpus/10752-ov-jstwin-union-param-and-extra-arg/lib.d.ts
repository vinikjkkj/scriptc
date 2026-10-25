export interface Pipe {
  isPipeline: true;
  write(data: string): unknown;
}
export class Sock {
  fd: number;
}
export declare class Base {
  send(command: string, stream?: Pipe | Sock): string;
}
export default class Sub extends Base {
  static tag: string;
  send(command: string, stream?: Pipe | Sock): string;
}
