/**
 * InputHandler.ts
 *
 * A fully decoupled, configurable keyboard-to-SNES-controller mapping module.
 *
 * Architecture:
 *   - This module owns its own key-press tracking and mapping table.
 *   - It has zero dependencies on React or any UI framework.
 *   - The host (App.tsx) calls `attach()` / `detach()` to connect browser events,
 *     and queries `getController1State()` each frame to update the bus.
 *   - The mapping is stored as a plain serializable object so it can be persisted
 *     to localStorage and loaded back without any special serialization logic.
 */

// ─── SNES Button Bit Masks ────────────────────────────────────────────────────
// These mirror the auto-joypad read format (bits 15-0):
// Bit 15: B  | Bit 14: Y  | Bit 13: Select | Bit 12: Start
// Bit 11: Up | Bit 10: Down | Bit 9: Left   | Bit 8: Right
// Bit 7: A   | Bit 6: X   | Bit 5: L       | Bit 4: R
export const SNES_BUTTON = {
  B:      0x8000,
  Y:      0x4000,
  SELECT: 0x2000,
  START:  0x1000,
  UP:     0x0800,
  DOWN:   0x0400,
  LEFT:   0x0200,
  RIGHT:  0x0100,
  A:      0x0080,
  X:      0x0040,
  L:      0x0020,
  R:      0x0010,
} as const;

export type SnesButton = keyof typeof SNES_BUTTON;

// ─── Default Mapping ──────────────────────────────────────────────────────────
// Keys are stored as `e.key` values, lowercased.
export const DEFAULT_KEY_MAP: Record<SnesButton, string> = {
  B:      'z',
  Y:      'a',
  SELECT: 'shift',
  START:  'enter',
  UP:     'arrowup',
  DOWN:   'arrowdown',
  LEFT:   'arrowleft',
  RIGHT:  'arrowright',
  A:      'x',
  X:      's',
  L:      'q',
  R:      'e',
};

export const BUTTON_LABELS: Record<SnesButton, string> = {
  B:      'B',
  Y:      'Y',
  SELECT: 'Select',
  START:  'Start',
  UP:     '↑ Up',
  DOWN:   '↓ Down',
  LEFT:   '← Left',
  RIGHT:  '→ Right',
  A:      'A',
  X:      'X',
  L:      'L',
  R:      'R',
};

const STORAGE_KEY = 'snes_ts_keymap_v1';

// ─── InputHandler class ───────────────────────────────────────────────────────
export class InputHandler {
  /** Live set of browser keys currently held down */
  private keysDown = new Set<string>();

  /** Maps each SNES button name to the browser key that triggers it */
  private keyMap: Record<SnesButton, string>;

  /** Bound event handler refs so we can remove them later */
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;

  /** Listeners notified whenever the mapping changes */
  private changeListeners: Array<(map: Record<SnesButton, string>) => void> = [];

  constructor() {
    this.keyMap = this._loadMapping();

    this._onKeyDown = (e: KeyboardEvent) => {
      const key = this._normalizeKey(e);
      this.keysDown.add(key);
      // Prevent browser scroll on arrow keys and space
      if (
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)
      ) {
        e.preventDefault();
      }
    };

    this._onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(this._normalizeKey(e));
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Attach keyboard event listeners to the window. */
  public attach(): void {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** Detach keyboard event listeners. */
  public detach(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.keysDown.clear();
  }

  // ── Controller state ───────────────────────────────────────────────────────

  /**
   * Compute the 16-bit SNES controller 1 bitmask based on the current
   * keyboard state and the active mapping.
   * Call this every frame before writing to `bus.controller1State`.
   */
  public getController1State(): number {
    let state = 0;
    for (const btn of Object.keys(this.keyMap) as SnesButton[]) {
      const key = this.keyMap[btn];
      if (key && this.keysDown.has(key)) {
        state |= SNES_BUTTON[btn];
      }
    }
    return state;
  }

  /**
   * Raw read of a specific key being held.
   * Useful for the UI controller HUD.
   */
  public isKeyDown(key: string): boolean {
    return this.keysDown.has(key.toLowerCase());
  }

  // ── Mapping API ────────────────────────────────────────────────────────────

  /** Return a copy of the current mapping. */
  public getMapping(): Record<SnesButton, string> {
    return { ...this.keyMap };
  }

  /**
   * Remap a single SNES button to a new keyboard key.
   * Automatically saves to localStorage and notifies listeners.
   */
  public remap(button: SnesButton, newKey: string): void {
    this.keyMap[button] = newKey.toLowerCase();
    this._saveMapping();
    this._notifyChange();
  }

  /** Reset mapping to factory defaults. */
  public resetToDefaults(): void {
    this.keyMap = { ...DEFAULT_KEY_MAP };
    this._saveMapping();
    this._notifyChange();
  }

  /**
   * Subscribe to mapping changes.
   * Returns an unsubscribe function.
   */
  public onMappingChange(
    listener: (map: Record<SnesButton, string>) => void
  ): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _normalizeKey(e: KeyboardEvent): string {
    // Normalize Shift to 'shift' regardless of left/right
    if (e.key === 'Shift' || e.key === 'ShiftLeft' || e.key === 'ShiftRight') {
      return 'shift';
    }
    return e.key.toLowerCase();
  }

  private _loadMapping(): Record<SnesButton, string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new buttons added in future versions are covered
        return { ...DEFAULT_KEY_MAP, ...parsed };
      }
    } catch {
      // Ignore parse errors
    }
    return { ...DEFAULT_KEY_MAP };
  }

  private _saveMapping(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keyMap));
    } catch {
      // Ignore storage errors
    }
  }

  private _notifyChange(): void {
    const snapshot = this.getMapping();
    for (const fn of this.changeListeners) {
      fn(snapshot);
    }
  }
}
