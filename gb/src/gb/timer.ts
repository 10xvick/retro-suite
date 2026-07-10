// Timer - Game Boy has a 16-bit DIV counter (incremented at 16384Hz = every 256 cycles)
// and TIMA (timer counter) which can increment at different rates based on TAC register.

export class Timer {
  div: number = 0xAC08;     // 0xFF04 returns div >> 8
  tima: number = 0;         // 0xFF05 - timer counter
  tma: number = 0;          // 0xFF06 - timer modulo (reload value)
  tac: number = 0xF8;       // 0xFF07 - timer control

  private timaCounter: number = 0;  // Counts M-cycles for TIMA

  private onRequestInterrupt: () => void;

  // Clock divider for each TAC setting (in M-cycles; GB CPU runs at ~4.19MHz,
  // 1 M-cycle = 4 T-cycles = ~238ns; DIV increments every 256/4=64 M-cycles)
  private static readonly freqToCycles = [256, 4, 16, 64];

  constructor(onRequestInterrupt: () => void) {
    this.onRequestInterrupt = onRequestInterrupt;
  }

  tick(mCycles: number) {
    // DIV increments every 256 T-cycles = 64 M-cycles
    // We track DIV as a 16-bit value incremented by mCycles*4 (T-cycles)
    this.div = (this.div + (mCycles << 2)) & 0xFFFF;

    // TIMA increments based on TAC bit 2 (enable) and bits 0-1 (frequency)
    if (this.tac & 0x04) {
      this.timaCounter += mCycles;
      const threshold = Timer.freqToCycles[this.tac & 0x03];
      while (this.timaCounter >= threshold) {
        this.timaCounter -= threshold;
        this.tima++;
        if (this.tima > 0xFF) {
          this.tima = this.tma;
          this.onRequestInterrupt();
        }
      }
    }
  }
}
