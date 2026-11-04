export interface Connection {
  protocolError(message: string): null;
}
export declare class Command {
  log: string[];
  execute(packet: string, connection: Connection): boolean;
}
export declare class Query extends Command {
  constructor(count: number);
  seen: number;
}
export declare class Execute extends Query {}
export declare class Handshake extends Command {}
