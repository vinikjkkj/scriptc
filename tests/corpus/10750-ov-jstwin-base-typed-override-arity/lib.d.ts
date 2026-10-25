export declare class Base {
  send(command: string, stream?: string): string;
}
export default class Redis extends Base {
  static Cluster: number;
  static Command: string;
  constructor(port: number);
  send(command: string, stream?: string): string;
}
export interface Redis {
  extra: number;
}
