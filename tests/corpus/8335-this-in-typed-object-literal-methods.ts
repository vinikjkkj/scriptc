const account = {
  balance: 100,
  history: [] as string[],
  deposit(amount: number): number {
    this.balance += amount;
    this.history.push("d" + amount);
    return this.balance;
  },
  withdraw(amount: number): boolean {
    if (amount > this.balance) return false;
    this.balance -= amount;
    this.history.push("w" + amount);
    return true;
  },
  summary(): string { return this.balance + ":" + this.history.join(","); },
};
console.log(account.deposit(50), account.withdraw(500), account.withdraw(20), account.summary());
function run(): string {
  const o = { x: 1, bump() { this.x++; return this.x; } };
  o.bump(); o.bump();
  return String(o.x) + "," + o.bump();
}
console.log(run());
