export default function asCallback<T>(promise: Promise<T>, nodeback: ((err: Error | null, v?: T) => void) | undefined): Promise<T>;
export declare const twice: (x: number) => number;
