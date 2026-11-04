export declare class Commander {
  n: number;
  get(key: string): string;
  set(key: string, value: string): string;
  quit(): string;
}
export declare class Redis extends Commander {
  label: string;
  constructor();
}
