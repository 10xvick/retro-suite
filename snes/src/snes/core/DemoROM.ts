export function createDemoROM(): Uint8Array {
  const rom = new Uint8Array(32768); // 32KB LoROM Bank 0

  // Machine Code Assembly instructions starting at offset 0 (maps to $8000 in SNES space)
  const code = [
    0x18,                   // 8000: CLC (Clear Carry)
    0xFB,                   // 8001: XCE (Exchange Carry/Emulation - enter Native 16-bit mode)
    0xC2, 0x30,             // 8002: REP #$30 (16-bit accumulator A, 16-bit Index X & Y)
    0xA2, 0xFF, 0x01,       // 8004: LDX #$01FF (Setup Stack)
    0x9A,                   // 8007: TXS
    0xE2, 0x20,             // 8008: SEP #$20 (8-bit Accumulator, keep 16-bit Index X & Y)

    // --- CGRAM Palettes Setup ---
    0x9C, 0x21, 0x21,       // 800A: STZ $2121 (CGRAM index 0 - Backdrop)
    0xA9, 0x10,             // 800D: LDA #$10 (Dark slate blue low byte: 0x4210)
    0x8D, 0x22, 0x21,       // 800F: STA $2122
    0xA9, 0x2A,             // 8012: LDA #$2A (Dark slate blue high byte)
    0x8D, 0x22, 0x21,       // 8014: STA $2122

    // Palette 0, Index 1 (Grid Lines color - Slate Grey: 0x252B -> Low 0x2B, High 0x25)
    0xA9, 0x01,             // 8017: LDA #$01
    0x8D, 0x21, 0x21,       // 8019: STA $2121
    0xA9, 0x2B,             // 801C: LDA #$2B
    0x8D, 0x22, 0x21,       // 801E: STA $2122
    0xA9, 0x25,             // 8021: LDA #$25
    0x8D, 0x22, 0x21,       // 8023: STA $2122

    // Sprite Palette 0, Index 1 (Red Hat: 0x001F -> Low 0x1F, High 0x00)
    0xA9, 0x81,             // 8026: LDA #$81 (CGRAM Index 129)
    0x8D, 0x21, 0x21,       // 8028: STA $2121
    0xA9, 0x1F,             // 802B: LDA #$1F
    0x8D, 0x22, 0x21,       // 802D: STA $2122
    0xA9, 0x00,             // 8030: LDA #$00
    0x8D, 0x22, 0x21,       // 8032: STA $2122

    // Sprite Palette 0, Index 2 (Yellow Face: 0x03FF -> Low 0xFF, High 0x03)
    0xA9, 0xFF,             // 8035: LDA #$FF
    0x8D, 0x22, 0x21,       // 8037: STA $2122
    0xA9, 0x03,             // 803A: LDA #$03
    0x8D, 0x22, 0x21,       // 803C: STA $2122

    // --- VRAM Background Tiles (Grid patterns) ---
    0x9C, 0x16, 0x21,       // 803E: STZ $2116 (VRAM Address $0000)
    0x9C, 0x17, 0x21,       // 8041: STZ $2117
    
    // Fill tile 0 (blank) and tile 1 (grid border line)
    // We run a loop to write 16 words (32 bytes) of pattern data
    0xA2, 0x00, 0x00,       // 8044: LDX #$0000
    // Loop offset 0x47:
    0xA9, 0xFF,             // 8047: LDA #$FF (Pattern plane 0 low)
    0x8D, 0x18, 0x21,       // 8049: STA $2118
    0xA9, 0x81,             // 804C: LDA #$81 (Pattern plane 0 high)
    0x8D, 0x19, 0x21,       // 804E: STA $2119
    0xE8,                   // 8051: INX
    0xE0, 0x10, 0x00,       // 8052: CPX #$0010 (16 words)
    0xD0, 0xF0,             // 8055: BNE to 8047 (-16 offset)

    // --- VRAM Sprite Tiles (Character asset at $4000) ---
    0x9C, 0x16, 0x21,       // 8057: STZ $2116 (VRAM Addr low)
    0xA9, 0x40,             // 805A: LDA #$40 (VRAM Addr high -> $4000)
    0x8D, 0x17, 0x21,       // 805C: STA $2117
    
    // Fill sprite tile 0 (4bpp smiley face)
    0xA2, 0x00, 0x00,       // 805F: LDX #$0000
    // Loop offset 0x62:
    0xA9, 0x3C,             // 8062: LDA #$3C (Bitplane 0-1 low)
    0x8D, 0x18, 0x21,       // 8064: STA $2118
    0xA9, 0x7E,             // 8067: LDA #$7E (Bitplane 0-1 high)
    0x8D, 0x19, 0x21,       // 8069: STA $2119
    0xE8,                   // 806C: INX
    0xE0, 0x10, 0x00,       // 806D: CPX #$0010
    0xD0, 0xF0,             // 8070: BNE to 8062 (-16 offset)

    // --- BG1 Tilemap Setup ($1000) ---
    0x9C, 0x16, 0x21,       // 8072: STZ $2116 (VRAM Addr low)
    0xA9, 0x10,             // 0x75: LDA #$10 (VRAM Addr high -> $1000)
    0x8D, 0x17, 0x21,       // 8077: STA $2117
    
    // Fill 32x32 tilemap (1024 words) with Tile Index 0 (Grid border)
    0xA2, 0x00, 0x00,       // 807A: LDX #$0000
    // Loop offset 0x7D:
    0xA9, 0x00,             // 807D: LDA #$00 (Tile index 0)
    0x8D, 0x18, 0x21,       // 807F: STA $2118
    0xA9, 0x00,             // 8082: LDA #$00 (No flip, Palette index 0)
    0x8D, 0x19, 0x21,       // 8084: STA $2119
    0xE8,                   // 8087: INX
    0xE0, 0x00, 0x04,       // 8088: CPX #$0400 (1024 tiles)
    0xD0, 0xF0,             // 808B: BNE to 807D

    // --- Configure PPU and Display ---
    0xA9, 0x01,             // 808D: LDA #$01
    0x8D, 0x05, 0x21,       // 808F: STA $2105 (BG Mode 1)
    0xA9, 0x10,             // 8092: LDA #$10 (Tilemap at VRAM $1000)
    0x8D, 0x07, 0x21,       // 8094: STA $2107 (BG1 Tilemap)
    0x9C, 0x0B, 0x21,       // 8097: STZ $210B (BG1 Character Base Address = $0000)
    0xA9, 0x0F,             // 809A: LDA #$0F (Brightness 15, Enable Screen)
    0x8D, 0x00, 0x21,       // 809C: STA $2100 (Screen Display)

    // --- Setup Sprite Coordinates in WRAM ---
    0xA9, 0x78,             // 809F: LDA #$78 (Initial X = 120)
    0x85, 0x00,             // 80A1: STA $00 (Direct Page offset 0)
    0xA9, 0x64,             // 80A3: LDA #$64 (Initial Y = 100)
    0x85, 0x02,             // 80A5: STA $02 (Direct Page offset 2)

    // --- Main Game Loop (80A7) ---
    0x9C, 0x02, 0x21,       // 80A7: STZ $2102 (OAM Addr low = 0)
    0x9C, 0x03, 0x21,       // 80AA: STZ $2103 (OAM Addr high = 0)

    // Write Sprite 0 X pos
    0xA5, 0x00,             // 80AD: LDA $00
    0x8D, 0x04, 0x21,       // 80AF: STA $2104
    // Write Sprite 0 Y pos
    0xA5, 0x02,             // 80B2: LDA $02
    0x8D, 0x04, 0x21,       // 80B4: STA $2104
    // Write Sprite 0 Tile Index
    0xA9, 0x00,             // 80B7: LDA #$00
    0x8D, 0x04, 0x21,       // 80B9: STA $2104
    // Write Sprite 0 Attributes (palette 0)
    0xA9, 0x00,             // 80BC: LDA #$00
    0x8D, 0x04, 0x21,       // 80BE: STA $2104

    // Read Controller 1 Input State Auto-Read register ($4219 high byte)
    0xAD, 0x19, 0x42,       // 80C1: LDA $4219
    
    // Check UP button (Bit 3, value 0x08)
    0x89, 0x08,             // 80C4: BIT #$08
    0xF0, 0x02,             // 80C6: BEQ to NoUp
    0xC6, 0x02,             // 80C8: DEC $02 (Decrement Y)
    // NoUp (80CA):
    // Check DOWN button (Bit 2, value 0x04)
    0x89, 0x04,             // 80CA: BIT #$04
    0xF0, 0x02,             // 80CC: BEQ to NoDown
    0xE6, 0x02,             // 80CE: INC $02 (Increment Y)
    // NoDown (80D0):
    // Check LEFT button (Bit 1, value 0x02)
    0x89, 0x02,             // 80D0: BIT #$02
    0xF0, 0x02,             // 80D2: BEQ to NoLeft
    0xC6, 0x00,             // 80D4: DEC $00 (Decrement X)
    // NoLeft (80D6):
    // Check RIGHT button (Bit 0, value 0x01)
    0x89, 0x01,             // 80D6: BIT #$01
    0xF0, 0x02,             // 80D8: BEQ to NoRight
    0xE6, 0x00,             // 80DA: INC $00 (Increment X)
    // NoRight (80DC):

    // Spin Delay Loop to rate-limit CPU inputs
    0xA2, 0x00, 0x10,       // 80DC: LDX #$1000
    // Delay loop (80DF):
    0xCA,                   // 80DF: DEX
    0xD0, 0xFD,             // 80E0: BNE to 80DF (-3 offset)

    // Loop back to main loop
    0x4C, 0xA7, 0x80        // 80E2: JMP $80A7
  ];

  // Write compiled code to ROM bank 0 start ($8000 corresponds to offset 0x0000 in LoROM file)
  for (let i = 0; i < code.length; i++) {
    rom[i] = code[i];
  }

  // --- SNES Header configuration at $7FC0 (32704) ---
  const headerOffset = 0x7FC0;
  
  // Game Title (21 bytes)
  const title = 'ANTIGRAVITY DEMO SNES';
  for (let i = 0; i < 21; i++) {
    rom[headerOffset + i] = i < title.length ? title.charCodeAt(i) : 0x20;
  }

  rom[headerOffset + 0x15] = 0x20; // ROM Speed / Map Mode: LoROM FastROM
  rom[headerOffset + 0x16] = 0x02; // ROM Type: ROM & RAM & Battery
  rom[headerOffset + 0x17] = 0x08; // ROM Size: 32KB (calculated as Math.pow(2, 8) * 1KB)
  rom[headerOffset + 0x18] = 0x03; // SRAM Size: 8KB
  rom[headerOffset + 0x19] = 0x01; // Country: US/NTSC
  rom[headerOffset + 0x1A] = 0x33; // Developer: Custom
  rom[headerOffset + 0x1B] = 0x00; // Version 1.0

  // Checksum and complement
  rom[headerOffset + 0x1C] = 0x55; // Complement
  rom[headerOffset + 0x1D] = 0x55;
  rom[headerOffset + 0x1E] = 0xAA; // Checksum
  rom[headerOffset + 0x1F] = 0xAA;

  // --- Native Vector Interrupts ($7FE0) ---
  // Native RESET Vector at $7FEC maps to $FFFC in CPU bank 0
  rom[headerOffset + 0x2C] = 0x00; // Native RESET Low Byte: $8000
  rom[headerOffset + 0x2D] = 0x80; // Native RESET High Byte: $8000

  // --- Emulation Vector Interrupts ($7FF0) ---
  // Emulation RESET Vector at $7FFC maps to $FFFC in CPU bank 0
  rom[headerOffset + 0x3C] = 0x00; // Emulation RESET Low Byte: $8000
  rom[headerOffset + 0x3D] = 0x80; // Emulation RESET High Byte: $8000

  return rom;
}
