export class Shape {
  area(scale) {
    return scale * 100;
  }
  label() {
    return "shape";
  }
}
export default class Square extends Shape {
  constructor(side) {
    super();
    this.side = side;
  }
  area(scale, bonus) {
    return Number(this.side) * Number(this.side) * scale + (bonus === undefined ? 0 : Number(bonus));
  }
  label(extra) {
    return "square" + (extra === undefined ? "" : extra);
  }
}
Square.made = 0;
