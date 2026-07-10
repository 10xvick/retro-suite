import { Bus } from './bus';

export class Controller {
  private bus: Bus;
  
  // Mapping key strings to their NES button bit mask
  private keyMapping: { [key: string]: number } = {
    'x': 0x01,         // Button A
    'z': 0x02,         // Button B
    'shift': 0x04,     // Select
    'enter': 0x08,     // Start
    'arrowup': 0x10,   // DPAD Up
    'w': 0x10,
    'arrowdown': 0x20, // DPAD Down
    's': 0x20,
    'arrowleft': 0x40, // DPAD Left
    'a': 0x40,
    'arrowright': 0x80,// DPAD Right
    'd': 0x80
  };

  private currentState = 0x00;

  constructor(bus: Bus) {
    this.bus = bus;
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  private handleKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (this.keyMapping[key] !== undefined) {
      this.currentState |= this.keyMapping[key];
      this.bus.controllerState[0] = this.currentState;
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (this.keyMapping[key] !== undefined) {
      this.currentState &= ~this.keyMapping[key];
      this.bus.controllerState[0] = this.currentState;
    }
  }
}
