// Cumulative session budget kept by the web backend (each agent process only knows its own budget).
// reserve the per-report cap before spawning, settle to the real charge afterwards. All amounts are BigInt atomic USDC.
export class SessionBudget {
  constructor(budgetAtomic, capAtomic) {
    this.budget = BigInt(budgetAtomic); this.cap = BigInt(capAtomic);
    this.spent = 0n; this.reserved = 0n;
  }
  get remaining() { const r = this.budget - this.spent - this.reserved; return r < 0n ? 0n : r; }
  canReserve() { return this.remaining >= this.cap; }
  reserve() { if (!this.canReserve()) return false; this.reserved += this.cap; return true; }
  /** Release the reservation and charge `charge` (clamped to [0, cap]). */
  settle(charge) {
    let c = BigInt(charge); if (c < 0n) c = 0n; if (c > this.cap) c = this.cap;
    this.reserved -= this.cap; if (this.reserved < 0n) this.reserved = 0n;
    this.spent += c;
  }
  snapshot() {
    return { budgetAtomic: String(this.budget), spentAtomic: String(this.spent), reservedAtomic: String(this.reserved), remainingAtomic: String(this.remaining) };
  }
}
