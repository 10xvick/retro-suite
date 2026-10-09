// Atari 2600 Joystick & Console Switch Controller
// Maps retro-suit controller inputs to Atari SWCHA, SWCHB, and TIA INPT4/5

export class Controller {
    // Active low joystick direction state: bit 0..3 (player 1), bit 4..7 (player 0)
    public swcha = 0xFF;

    // Active low console switches on SWCHB:
    // bit 0 = Reset, bit 1 = Select, bit 3 = Color/BW (1=color), bit 6/7 = Difficulty (0=easy)
    public swchb = 0xFF;

    // Active low fire button: bit 7 = 0 when pressed, 1 when released
    public inpt4 = 0x80;
    public inpt5 = 0x80;

    // Backward-compatible state property (active-low: bit0=up, bit1=down, bit2=left, bit3=right, bit4=fire)
    public state = 0xFF;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.swcha = 0xFF;
        this.swchb = 0xCB; // Color mode set (bit 3=1), difficulty B (bits 6,7=0), switches unpressed (bits 0,1=1)
        this.inpt4 = 0x80;
        this.inpt5 = 0x80;
        this.state = 0xFF;
    }

    // Maps standard SNES controller state to Atari inputs
    // SNES bits:
    // 0x0080: A (Fire)
    // 0x8000: B (Fire)
    // 0x4000: Y (Fire)
    // 0x2000: Select (Console Select)
    // 0x1000: Start (Console Reset)
    // 0x0800: Up
    // 0x0400: Down
    // 0x0200: Left
    // 0x0100: Right
    public setControllerState(snesState: number): void {
        let swcha = 0xFF;
        let swchb = 0xCB; // default color mode, unpressed
        let fire = 0x80;

        // Player 0 D-pad on SWCHA (bits 4..7, active low)
        if (snesState & 0x0800) swcha &= ~0x10; // Up (bit 4)
        if (snesState & 0x0400) swcha &= ~0x20; // Down (bit 5)
        if (snesState & 0x0200) swcha &= ~0x40; // Left (bit 6)
        if (snesState & 0x0100) swcha &= ~0x80; // Right (bit 7)

        // Fire button on TIA INPT4 (bit 7, active low)
        if ((snesState & 0x0080) || (snesState & 0x8000) || (snesState & 0x4000)) {
            fire = 0x00;
        }

        // Console Switches on SWCHB
        if (snesState & 0x1000) swchb &= ~0x01; // Start -> Reset switch (active low)
        if (snesState & 0x2000) swchb &= ~0x02; // Select -> Game Select switch (active low)

        this.swcha = swcha;
        this.swchb = swchb;
        this.inpt4 = fire;

        // Maintain backward compatibility with legacy state byte
        let legacyState = 0xFF;
        if (snesState & 0x0800) legacyState &= ~0x01; // Up
        if (snesState & 0x0400) legacyState &= ~0x02; // Down
        if (snesState & 0x0200) legacyState &= ~0x04; // Left
        if (snesState & 0x0100) legacyState &= ~0x08; // Right
        if (fire === 0x00) legacyState &= ~0x10;      // Fire
        this.state = legacyState;
    }
}