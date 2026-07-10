export interface ApuCpuContext {
  pc: number;
  pb: number;
  cycles: number;
}

export interface ApuPortWriteEvent {
  port: number;
  value: number;
}

export class ApuPortBridge {
  private ports = new Uint8Array([0xAA, 0xBB, 0x00, 0x00]);
  private writeEvents: ApuPortWriteEvent[] = [];
  public onReadPort: ((port: number) => number) | null = null;
  public onSync: ((cpuCycles: number) => void) | null = null;

  public reset(): void {
    this.ports.set([0xAA, 0xBB, 0x00, 0x00]);
    this.writeEvents.length = 0;
  }

  public read(addr: number, wram3: number, cpu: ApuCpuContext | null): number {
    const a = addr & 0xFFFF;
    const port = a - 0x2140;

    if (cpu && this.onSync) {
      this.onSync(cpu.cycles);
    }

    if (this.onReadPort && port >= 0 && port <= 3) {
      const val = this.onReadPort(port);
      if (val !== -1) return val;
    }



    if (a === 0x2140) {
      const val = this.ports[0];
      if (val === 0xCC) {
        this.ports[0] = this.ports[1];
        return 0xCC;
      }
      return val;
    }

    if (a === 0x2142) {
      // Keep existing execution-confirmation behavior used by current ROM paths.
      return wram3 & 0xFF;
    }

    return this.ports[port] & 0xFF;
  }

  public write(addr: number, val: number, cycles: number): void {
    if (this.onSync) {
      this.onSync(cycles);
    }

    const a = addr & 0xFFFF;
    const v = val & 0xFF;
    const port = a - 0x2140;

    this.ports[port] = v;
    if (port === 0) {
      this.ports[0] = v;
    }
    if (port === 3 && (v === 0 || v === 0x0E)) {
      this.ports[0] = 0xAA;
      this.ports[1] = 0xBB;
    }

    this.writeEvents.push({ port, value: v });
  }

  public consumeWriteEvents(): ApuPortWriteEvent[] {
    if (this.writeEvents.length === 0) return [];
    const events = this.writeEvents;
    this.writeEvents = [];
    return events;
  }
}
