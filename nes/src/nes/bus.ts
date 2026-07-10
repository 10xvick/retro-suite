import { CPU } from './cpu';
import { PPU } from './ppu';
import { Cartridge } from './cartridge';
import { APU } from './apu';

export class Bus {
  public cpu!: CPU;
  public ppu!: PPU;
  public apu: APU = new APU();
  public cart: Cartridge | null = null;

  // 2KB CPU RAM
  public cpuRam: Uint8Array = new Uint8Array(2048);

  // Controller states
  public controllerState: Uint8Array = new Uint8Array(2); // [player1, player2]
  private controllerLatch: Uint8Array = new Uint8Array(2);
  private controllerStrobe: boolean = false;

  constructor() {
    this.apu.connectBus(this);
  }

  public connect(cpu: CPU, ppu: PPU) {
    this.cpu = cpu;
    this.ppu = ppu;
  }

  public insertCartridge(cart: Cartridge) {
    this.cart = cart;
    this.ppu.connectCartridge(cart);
  }

  public cpuWrite(addr: number, data: number) {
    // RAM write (mirrored up to 0x1FFF)
    if (addr >= 0x0000 && addr <= 0x1FFF) {
      this.cpuRam[addr & 0x07FF] = data;
    } 
    // PPU registers write (mirrored up to 0x3FFF)
    else if (addr >= 0x2000 && addr <= 0x3FFF) {
      this.ppu.cpuWrite(addr & 0x0007, data);
    } 
    // OAM DMA write
    else if (addr === 0x4014) {
      const page = data << 8;
      for (let i = 0; i < 256; i++) {
        const val = this.cpuRead(page + i);
        this.ppu.writeOam(i, val);
      }
      // OAM DMA halts CPU for 513 or 514 cycles
      this.cpu.dmaCycles += 513;
    } 
    // Controller strobe
    else if (addr === 0x4016) {
      this.controllerStrobe = (data & 0x01) !== 0;
      if (this.controllerStrobe) {
        this.controllerLatch[0] = this.controllerState[0];
        this.controllerLatch[1] = this.controllerState[1];
      }
    } 
    // APU register write
    else if ((addr >= 0x4000 && addr <= 0x4013) || addr === 0x4015 || addr === 0x4017) {
      this.apu.write(addr, data);
    }
    // Cartridge / Mapper write
    else if (addr >= 0x4020 && addr <= 0xFFFF) {
      if (this.cart) {
        this.cart.cpuWrite(addr, data);
      }
    }
  }

  public cpuRead(addr: number): number {
    // RAM read
    if (addr >= 0x0000 && addr <= 0x1FFF) {
      return this.cpuRam[addr & 0x07FF];
    } 
    // PPU registers read
    else if (addr >= 0x2000 && addr <= 0x3FFF) {
      return this.ppu.cpuRead(addr & 0x0007);
    } 
    // Controller 1 shift register
    else if (addr === 0x4016) {
      let data = 0;
      if (this.controllerStrobe) {
        data = this.controllerState[0] & 0x01;
      } else {
        data = this.controllerLatch[0] & 0x01;
        this.controllerLatch[0] >>= 1;
      }
      return data;
    } 
    // Controller 2 shift register
    else if (addr === 0x4017) {
      let data = 0;
      if (this.controllerStrobe) {
        data = this.controllerState[1] & 0x01;
      } else {
        data = this.controllerLatch[1] & 0x01;
        this.controllerLatch[1] >>= 1;
      }
      return data;
    } 
    // APU status register
    else if (addr === 0x4015) {
      return this.apu.readStatus();
    }
    // Cartridge / Mapper read
    else if (addr >= 0x4020 && addr <= 0xFFFF) {
      if (this.cart) {
        return this.cart.cpuRead(addr);
      }
    }
    return 0;
  }
}
