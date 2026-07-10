// GBA shared types & constants

export const GBA_WIDTH = 240;
export const GBA_HEIGHT = 160;

// Memory region bases
export const BIOS_BASE = 0x00000000;
export const BIOS_SIZE = 0x4000; // 16 KB
export const EWRAM_BASE = 0x02000000;
export const EWRAM_SIZE = 0x40000; // 256 KB
export const IWRAM_BASE = 0x03000000;
export const IWRAM_SIZE = 0x8000; // 32 KB
export const IO_BASE = 0x04000000;
export const IO_SIZE = 0x400;
export const PALETTE_BASE = 0x05000000;
export const PALETTE_SIZE = 0x400;
export const VRAM_BASE = 0x06000000;
export const VRAM_SIZE = 0x18000; // 96 KB
export const OAM_BASE = 0x07000000;
export const OAM_SIZE = 0x400;
export const CART_BASE = 0x08000000;

// CPU modes
export const M_USER = 0x10;
export const M_FIQ = 0x11;
export const M_IRQ = 0x12;
export const M_SVC = 0x13;
export const M_ABORT = 0x17;
export const M_UNDEF = 0x1b;
export const M_SYSTEM = 0x1f;

export const LOG = (msg: string) => {
  if (typeof globalThis !== "undefined" && (globalThis as any).process?.env?.GBA_DEBUG) console.log(msg);
};
