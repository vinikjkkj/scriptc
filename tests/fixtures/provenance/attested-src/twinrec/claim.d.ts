export declare function fulfilled(v: number): Promise<number>;
export declare function rejected(m: string): Promise<number>;
export declare function settled(v: number): Promise<number>;
export declare function timer(v: number): Promise<number>;
export declare function again(p: Promise<number>): Promise<number>;
export declare function wrong(): Promise<number>;
