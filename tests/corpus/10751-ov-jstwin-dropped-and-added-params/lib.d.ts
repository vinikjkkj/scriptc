export declare class Shape {
  area(scale: number): number;
  label(): string;
}
export default class Square extends Shape {
  static made: number;
  constructor(side: number);
  area(scale: number): number;
  label(): string;
}
