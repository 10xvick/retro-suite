// MOS 6532 RIOT (RAM, I/O, Timer) for Atari 2600
// Provides 128 bytes of RAM, console & controller I/O ports, and interval timer

export class PIA {
    // 128 bytes internal static RAM
    public ram: Uint8Array = new Uint8Array(128);

    // I/O Registers
    public swcha = 0xFF;  // Port A data (joysticks)
    public swacnt = 0x00; // Port A DDR (0=input, 1=output)
    public swchb = 0xCB;  // Port B data (console switches)
    public swbcnt = 0x00; // Port B DDR

    // Controller input state (active low, managed by Controller / Bus)
    public controllerState = 0xFF;
    public consoleSwitches = 0xCB;

    // Timer
    public timer = 0;              // Current timer value (0..255)
    public timerInterval = 1024;   // Prescaler interval: 1, 8, 64, 1024
    public timerCounter = 1024;    // Internal prescaler downcounter
    public timerUnderflow = false; // Set to true when counter passes below 0

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.ram.fill(0);
        this.swcha = 0xFF;
        this.swacnt = 0x00;
        this.swchb = 0xCB;
        this.swbcnt = 0x00;
        this.controllerState = 0xFF;
        this.consoleSwitches = 0xCB;
        this.timer = 0;
        this.timerInterval = 1024;
        this.timerCounter = 1024;
        this.timerUnderflow = false;
    }

    // Called once per CPU cycle (~1.19 MHz)
    public clock(): void {
        this.timerCounter--;
        if (this.timerCounter <= 0) {
            if (!this.timerUnderflow) {
                if (this.timer === 0) {
                    // Underflow: timer decrements from 0 to 0xFF, prescaler becomes 1
                    this.timer = 0xFF;
                    this.timerUnderflow = true;
                    this.timerCounter = 1;
                } else {
                    this.timer--;
                    this.timerCounter = this.timerInterval;
                }
            } else {
                // In underflow mode, decrements every 1 CPU cycle
                this.timer = (this.timer - 1) & 0xFF;
                this.timerCounter = 1;
            }
        }
    }

    // Memory read for addresses where PIA is mapped ($0080-$02FF)
    public read(addr: number): number {
        const a = addr & 0x03FF;

        // RAM: $0080-$00FF and $0180-$01FF (stack page mirror)
        if ((a & 0x0200) === 0) {
            if ((a & 0x0080) !== 0) {
                return this.ram[a & 0x7F];
            }
            return 0xFF;
        }

        // I/O & Timer: $0280-$029F (mirrored in $02A0-$02FF)
        if ((a & 0x0080) !== 0) {
            return this.readRegister(a);
        }

        return 0xFF;
    }

    private readRegister(addr: number): number {
        const reg = addr & 0x1F;

        // I/O Registers ($0280-$0283)
        if ((reg & 0x04) === 0) {
            switch (reg & 0x03) {
                case 0x00: // SWCHA - Port A
                    // Output bits from swcha, input bits from controllerState
                    return (this.swcha & this.swacnt) | (this.controllerState & ~this.swacnt);
                case 0x01: // SWACNT - Port A DDR
                    return this.swacnt;
                case 0x02: // SWCHB - Port B
                    return (this.swchb & this.swbcnt) | (this.consoleSwitches & ~this.swbcnt);
                case 0x03: // SWBCNT - Port B DDR
                    return this.swbcnt;
            }
        }

        // Timer Registers ($0284, $0285)
        if (reg === 0x04) {
            // INTIM: timer value. Reading clears timerUnderflow flag.
            const val = this.timer & 0xFF;
            this.timerUnderflow = false;
            return val;
        }

        if (reg === 0x05) {
            // TIMINT: timer interrupt flag on bit 7
            return this.timerUnderflow ? 0x80 : 0x00;
        }

        return 0xFF;
    }

    // Memory write for addresses where PIA is mapped ($0080-$02FF)
    public write(addr: number, data: number): void {
        const a = addr & 0x03FF;
        data &= 0xFF;

        // RAM: $0080-$00FF and $0180-$01FF (stack page mirror)
        if ((a & 0x0200) === 0) {
            if ((a & 0x0080) !== 0) {
                this.ram[a & 0x7F] = data;
            }
            return;
        }

        // I/O & Timer: $0280-$029F (mirrored)
        if ((a & 0x0080) !== 0) {
            this.writeRegister(a, data);
        }
    }

    private writeRegister(addr: number, data: number): void {
        const reg = addr & 0x1F;

        // I/O Registers ($0280-$0283)
        if ((reg & 0x04) === 0) {
            switch (reg & 0x03) {
                case 0x00: this.swcha = data; break;
                case 0x01: this.swacnt = data; break;
                case 0x02: this.swchb = data; break;
                case 0x03: this.swbcnt = data; break;
            }
            return;
        }

        // Timer write ($0294-$0297)
        if ((reg & 0x10) !== 0) {
            this.timer = data;
            this.timerUnderflow = false;
            switch (reg & 0x07) {
                case 0x04: this.timerInterval = 1; break;
                case 0x05: this.timerInterval = 8; break;
                case 0x06: this.timerInterval = 64; break;
                case 0x07: this.timerInterval = 1024; break;
                default: this.timerInterval = 1024; break;
            }
            this.timerCounter = this.timerInterval;
        }
    }

    public saveState(): any {
        return {
            ram: Array.from(this.ram),
            swcha: this.swcha,
            swacnt: this.swacnt,
            swchb: this.swchb,
            swbcnt: this.swbcnt,
            controllerState: this.controllerState,
            consoleSwitches: this.consoleSwitches,
            timer: this.timer,
            timerInterval: this.timerInterval,
            timerCounter: this.timerCounter,
            timerUnderflow: this.timerUnderflow,
        };
    }

    public loadState(state: any): void {
        if (!state) return;
        if (state.ram) this.ram.set(state.ram);
        if (typeof state.swcha === 'number') this.swcha = state.swcha;
        if (typeof state.swacnt === 'number') this.swacnt = state.swacnt;
        if (typeof state.swchb === 'number') this.swchb = state.swchb;
        if (typeof state.swbcnt === 'number') this.swbcnt = state.swbcnt;
        if (typeof state.controllerState === 'number') this.controllerState = state.controllerState;
        if (typeof state.consoleSwitches === 'number') this.consoleSwitches = state.consoleSwitches;
        if (typeof state.timer === 'number') this.timer = state.timer;
        if (typeof state.timerInterval === 'number') this.timerInterval = state.timerInterval;
        if (typeof state.timerCounter === 'number') this.timerCounter = state.timerCounter;
        if (typeof state.timerUnderflow === 'boolean') this.timerUnderflow = state.timerUnderflow;
    }
}