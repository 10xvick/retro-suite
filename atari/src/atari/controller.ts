// Atari 2600 Joystick Controller
// Maps SNES controller state to Atari joystick input

export class Controller {
    // Atari joystick state (active low)
    // bit0 = up, bit1 = down, bit2 = left, bit3 = right, bit4 = fire
    public state = 0xFF;

    constructor() { }

    public reset() {
        this.state = 0xFF;
    }

    // Map SNES controllerState to Atari joystick
    // SNES bits: 0x0080=A, 0x8000=B, 0x4000=Y, 0x2000=Select, 0x1000=Start,
    //            0x0800=Up, 0x0400=Down, 0x0200=Left, 0x0100=Right
    public setControllerState(snesState: number) {
        let state = 0xFF;

        // D-pad (active low)
        if (snesState & 0x0800) state &= ~0x01; // Up
        if (snesState & 0x0400) state &= ~0x02; // Down
        if (snesState & 0x0200) state &= ~0x04; // Left
        if (snesState & 0x0100) state &= ~0x08; // Right

        // Fire button (A or B)
        if (snesState & 0x0080) state &= ~0x10; // A = fire
        if (snesState & 0x8000) state &= ~0x10; // B = fire

        this.state = state;
    }
}