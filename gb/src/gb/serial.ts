// Serial transfer - used by Blargg's test ROMs to print messages.
// When SC bit 7 is set and bit 0 is 1 (external clock), the Game Boy shifts SB out
// one bit per 8 * 512 T-cycles. We accelerate this for test ROMs by completing
// each transfer immediately, then firing the serial interrupt.

export class Serial {
  sb: number = 0x00;        // 0xFF01 - serial transfer data
  sc: number = 0x7E;        // 0xFF02 - serial transfer control
  private onRequestInterrupt: () => void;
  private onByte: ((byte: number) => void) | null = null;

  // Slow (accurate) mode
  private bitsRemaining: number = 0;
  private shiftCounter: number = 0;
  private outgoingByte: number = 0;

  constructor(onRequestInterrupt: () => void) {
    this.onRequestInterrupt = onRequestInterrupt;
  }

  setByteHandler(handler: (byte: number) => void) {
    this.onByte = handler;
  }

  startTransfer() {
    this.outgoingByte = this.sb;
    // Bit 0 of SC selects internal (1) or external (0) clock.
    // Internal clock = 8192Hz (bit shift every 128 T-cycles, 8 bits = 1024 T-cycles = 256 M-cycles)
    // External clock = controlled by master, very slow
    if (this.sc & 0x01) {
      // Internal clock: complete transfer
      // For test ROM output we complete in 256 M-cycles (8 * 32)
      this.bitsRemaining = 8;
      this.shiftCounter = 0;
    } else {
      // External clock: transfer never happens (we have no master)
      // Some games wait for serial via this path - we just leave SC bit 7 set
      // or force-complete after a delay to avoid hanging test ROMs.
      this.bitsRemaining = 8;
      this.shiftCounter = 0;
    }
  }

  tick(mCycles: number): boolean {
    if (this.bitsRemaining === 0) return false;
    // Each bit takes 8 M-cycles in our accelerated model (real GB: 32 M-cycles per bit)
    this.shiftCounter += mCycles;
    while (this.shiftCounter >= 8 && this.bitsRemaining > 0) {
      this.shiftCounter -= 8;
      this.sb = ((this.sb << 1) | 0x01) & 0xFF;  // shift left, incoming bit is 1 (no master)
      this.bitsRemaining--;
    }
    if (this.bitsRemaining === 0) {
      // Transfer complete: clear SC bit 7, fire serial interrupt
      this.sc &= ~0x80;
      if (this.onByte) this.onByte(this.outgoingByte);
      this.onRequestInterrupt();
      return true;
    }
    return false;
  }
}
