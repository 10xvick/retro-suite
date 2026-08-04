// PIA - Peripheral Interface Adaptor (6532)
// Provides 128 bytes of RAM, I/O ports for controllers, and a timer

export class PIA {
    // 128 bytes of RAM
    public ram: Uint8Array = new Uint8Array(128);

    // I/O ports
    public swcha = 0xFF; // Port A (joystick/console switches)
    public swchb = 0xFF; // Port B (console switches)
    public swacnt = 0x00; // Port A data direction
    public swbcnt = 0x00; // Port B data direction

    // Timer
    public timer = 0;
    public timerInterval = 0;
    public timerEnabled = false;
    public timerInterrupt = false;

    // Controller state (from emulator)
    public controllerState = 0xFF; // Active low: bit0=up, bit1=down, bit2=left, bit3=right, bit4=fire

    constructor() { }

    public reset() {
        this.ram.fill(0);
        this.swcha = 0xFF;
        this.swchb = 0xFF;
        this.swacnt = 0x00;
        this.swbcnt = 0x00;
        this.timer = 0;
        this.timerInterval = 0;
        this.timerEnabled = false;
        this.timerInterrupt = false;
        this.controllerState = 0xFF;
    }

    public read(addr: number): number {
        addr &= 0x3FF;

        // RAM (mirrored every 128 bytes)
        if (addr < 0x80) {
            return this.ram[addr];
        }

        // RAM mirror
        if (addr >= 0x80 && addr < 0x100) {
            return this.ram[addr & 0x7F];
        }

        // I/O registers
        switch (addr & 0x3F) {
            case 0x00: // SWCHA - Port A (joystick)
                return this.swcha & this.controllerState;
            case 0x01: // SWACNT - Port A data direction
                return this.swacnt;
            case 0x02: // SWCHB - Port B (console switches)
                return this.swchb;
            case 0x03: // SWBCNT - Port B data direction
                return this.swbcnt;
            case 0x04: // INTIM - timer read
                return this.timer & 0xFF;
            case 0x05: // TIMINT - timer interrupt flag
                return this.timerInterrupt ? 0x80 : 0x00;
            default:
                return 0xFF;
        }
    }

    public write(addr: number, data: number) {
        addr &= 0x3FF;
        data &= 0xFF;

        // RAM
        if (addr < 0x80) {
            this.ram[addr] = data;
            return;
        }

        // RAM mirror
        if (addr >= 0x80 && addr < 0x100) {
            this.ram[addr & 0x7F] = data;
            return;
        }

        // I/O registers
        switch (addr & 0x3F) {
            case 0x00: // SWCHA - Port A output
                this.swcha = data;
                break;
            case 0x01: // SWACNT - Port A data direction
                this.swacnt = data;
                break;
            case 0x02: // SWCHB - Port B output
                this.swchb = data;
                break;
            case 0x03: // SWBCNT - Port B data direction
                this.swbcnt = data;
                break;
            case 0x04: // TIM1T - timer 1 clock interval
                this.timerInterval = 1;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x05: // TIM8T - timer 8 clock interval
                this.timerInterval = 8;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x06: // TIM64T - timer 64 clock interval
                this.timerInterval = 64;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x07: // T1024T - timer 1024 clock interval
                this.timerInterval = 1024;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x14: // TIM1T (mirror)
                this.timerInterval = 1;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x15: // TIM8T (mirror)
                this.timerInterval = 8;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x16: // TIM64T (mirror)
                this.timerInterval = 64;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x17: // T1024T (mirror)
                this.timerInterval = 1024;
                this.timer = data;
                this.timerEnabled = true;
                this.timerInterrupt = false;
                break;
            case 0x1C: // INTIM (write clears timer)
                this.timer = 0;
                this.timerEnabled = false;
                this.timerInterrupt = false;
                break;
            case 0x1D: // TIMINT (write clears interrupt)
                this.timerInterrupt = false;
                break;
        }
    }

    public clock() {
        if (this.timerEnabled) {
            this.timer--;
            if (this.timer < 0) {
                this.timer = 0xFF;
                this.timerInterrupt = true;
                this.timerEnabled = false;
            }
        }
    }
}