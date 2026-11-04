export const getTypeParser: (id: number, format?: string) => any;
// The declaration says function; the JS exports an object with `create`.
export const arrayParser: (source: string, transform: (entry: any) => any) => any[];
// Never exported by the JS and never read by any program.
export const neverRead: (source: string, transform: (entry: any) => any) => any[];
// The declaration and the JS agree: a function with `any` positions.
export const splitAll: (source: string, transform: (entry: any) => any) => any[];
export function parseIntArray(value: string): number[] | null;
