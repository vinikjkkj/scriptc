export interface FieldPacket { name: string }
export interface Header { affected: number }
export interface Row { id: number }
// The library's own spelling: its promise API answers a tuple with a FieldPacket array.
export interface Db {
  exec(sql: string): Promise<[Header, FieldPacket[]]>;
}
