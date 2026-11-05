import { hasFlag } from "./symmod";
export declare class Client {
  constructor(label: string);
  label: string;
  [hasFlag]: boolean;
  flagged(): boolean;
  mark(): void;
  describe(): string;
  static tag: string;
  static defaults: { port: number };
}
