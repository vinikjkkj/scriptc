import Cmd from "./cmd.js";
export interface Pipe {
  isPipeline: true;
  write(data: string): unknown;
}
export class Sock {
  fd: number;
}
export declare class Commander {
  sendCommand(command: Cmd, stream?: Pipe | Sock): unknown;
}
export default class Redis extends Commander {
  static Cluster: number;
  sendCommand(command: Cmd, stream?: Pipe | Sock): unknown;
}
