export const SPEC = Object.freeze({
  alpha: Object.freeze({ code: 1, type: "int", defaultValue: 10 }),
  beta: Object.freeze({ code: 2, type: "bool", defaultValue: false }),
  gamma: Object.freeze({ code: 3, type: "string", defaultValue: "g" }),
});
export type Spec = typeof SPEC;
export function fromJson(s: string): Spec { return JSON.parse(s) as Spec; }
