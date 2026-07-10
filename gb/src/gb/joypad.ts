// Joypad - handles input. Game Boy exposes input via 0xFF00 with a button/select
// matrix. Bit 5 (or 4) selects between action buttons and d-pad.

export class Joypad {
  // Current button states: bit set = pressed
  // Bit 0: Right/A, 1: Left/B, 2: Up/Select, 3: Down/Start
  buttons: number = 0x0F;   // A B Select Start - all unpressed
  dpad: number = 0x0F;      // Right Left Up Down - all unpressed
  selectButtons: boolean = false;  // true = selecting action buttons
  selectDpad: boolean = false;     // true = selecting d-pad

  // Callback to request joypad interrupt
  private onRequestInterrupt: () => void;

  constructor(onRequestInterrupt: () => void) {
    this.onRequestInterrupt = onRequestInterrupt;
  }

  read(): number {
    let result = 0xCF;   // Top 2 bits unused (read as 1), bottom 4 always 1 unless selected
    if (this.selectButtons) result &= ~(0x20);
    if (this.selectDpad) result &= ~(0x10);
    // Lower 4 bits: buttons/dpad selected
    if (this.selectButtons) result &= 0xF0 | this.buttons;
    if (this.selectDpad) result &= 0xF0 | this.dpad;
    return result;
  }

  write(value: number) {
    // Bit 5: select action buttons, Bit 4: select d-pad (0=selected)
    this.selectButtons = (value & 0x20) === 0;
    this.selectDpad = (value & 0x10) === 0;
  }

  // Called from keyboard input handler
  setKey(key: string, pressed: boolean) {
    let oldButtons = this.buttons;
    let oldDpad = this.dpad;

    switch (key) {
      case "a": case "A":
        this.buttons = pressed ? this.buttons & ~0x01 : this.buttons | 0x01;
        break;
      case "s": case "S":
      case "b": case "B":
        this.buttons = pressed ? this.buttons & ~0x02 : this.buttons | 0x02;
        break;
      case "Backspace":
        this.buttons = pressed ? this.buttons & ~0x04 : this.buttons | 0x04;
        break;
      case "Enter":
        this.buttons = pressed ? this.buttons & ~0x08 : this.buttons | 0x08;
        break;
      case "ArrowRight":
        this.dpad = pressed ? this.dpad & ~0x01 : this.dpad | 0x01;
        break;
      case "ArrowLeft":
        this.dpad = pressed ? this.dpad & ~0x02 : this.dpad | 0x02;
        break;
      case "ArrowUp":
        this.dpad = pressed ? this.dpad & ~0x04 : this.dpad | 0x04;
        break;
      case "ArrowDown":
        this.dpad = pressed ? this.dpad & ~0x08 : this.dpad | 0x08;
        break;
    }

    // Joypad interrupt fires on any high->low transition (button press)
    if (pressed) {
      if ((this.selectButtons && (oldButtons & ~this.buttons) !== 0) ||
          (this.selectDpad && (oldDpad & ~this.dpad) !== 0)) {
        this.onRequestInterrupt();
      }
    }
  }
}
