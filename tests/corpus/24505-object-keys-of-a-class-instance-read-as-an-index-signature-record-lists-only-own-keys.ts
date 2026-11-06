// mysql2's RowDataPacket and FieldPacket over a class whose getters live on the prototype: the declared members the instance only
// inherits are readable through the record but are not its own keys.
interface Row { label: string; [column: string]: any }
class Col {
  name = "a";
  flags = 0;
  get label(): string {
    return "L";
  }
}
const arr: unknown = [new Col(), new Col()];
const rs = arr as Row[];
console.log(JSON.stringify(Object.keys(rs[0]!)), rs[0]!.label);
