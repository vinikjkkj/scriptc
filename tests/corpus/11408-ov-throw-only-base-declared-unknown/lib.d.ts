export declare class Commander {
  send(command: string, stream?: string): unknown;
}
export default class Redis extends Commander {
  send(command: string, stream?: string): unknown;
}
