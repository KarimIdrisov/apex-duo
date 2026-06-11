// Seeded LCG (numerical-recipes constants) + a 32-bit avalanche mix.
// Determinism is load-bearing: same seed -> same race (host/client + balance harness).
export class RNG {
  constructor(seed) { this.state = (seed >>> 0) || 1; }
  next() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
  unit() { return this.next() / 4294967296; }          // [0,1)
  range(a, b) { return a + (b - a) * this.unit(); }
  // symmetric noise in [-m, m]
  noise(m) { return (this.unit() * 2 - 1) * m; }
}

// Avalanche so seed and seed+1 give well-separated streams (events RNG).
// Murmur3-finaliser constants — matches GDScript race_sim.mix32() exactly.
export function mix32(x) {
  x = (x >>> 0);
  x = ((x + 0x9E3779B9) >>> 0);
  x = (Math.imul(x ^ (x >>> 16), 0x85EBCA6B)) >>> 0;
  x = (Math.imul(x ^ (x >>> 13), 0xC2B2AE35)) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
