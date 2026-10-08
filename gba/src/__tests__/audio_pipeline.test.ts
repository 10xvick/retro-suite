import { describe, it, expect, beforeEach } from 'vitest';
import { GBA } from '../core/gba';
import { Apu } from '../core/apu';
import { Memory } from '../core/memory';

describe('GBA Audio Pipeline & Direct Sound Parity', () => {
  let gba: GBA;

  beforeEach(() => {
    gba = new GBA();
  });

  describe('Bug 1.1, 1.2, 1.3: SOUNDCNT_H Register Handling', () => {
    it('correctly parses SOUNDCNT_H via 16-bit write to 0x082', () => {
      // Direct Sound A: Vol 100% (bit 2=1), Right enable (bit 8=1), Left enable (bit 9=1), Timer 1 (bit 10=1)
      // Direct Sound B: Vol 50% (bit 3=0), Right enable (bit 12=1), Left disable (bit 13=0), Timer 0 (bit 14=0)
      // Bits: bit 2=1 (4), bit 8=1 (0x100), bit 9=1 (0x200), bit 10=1 (0x400), bit 12=1 (0x1000)
      // Total value: 0x1704
      gba.mem.writeIO16(0x082, 0x1704);

      expect(gba.apu.fifoAVolume).toBe(1); // 100%
      expect(gba.apu.fifoBVolume).toBe(0); // 50%
      expect(gba.apu.fifoAEnableRight).toBe(true);
      expect(gba.apu.fifoAEnableLeft).toBe(true);
      expect(gba.apu.fifoATimer).toBe(1);
      expect(gba.apu.fifoBEnableRight).toBe(true);
      expect(gba.apu.fifoBEnableLeft).toBe(false);
      expect(gba.apu.fifoBTimer).toBe(0);
    });

    it('updates SOUNDCNT_H via 32-bit write to 0x080 (Bug 1.2)', () => {
      // 32-bit write to 0x080: low 16 bits = SOUNDCNT_L, high 16 bits = SOUNDCNT_H
      const soundcntL = 0x77; // PSG volume
      const soundcntH = 0x0B04; // Sound A: vol 100% (bit 2), Right (bit 8), Left (bit 9), Timer 0; Sound B: reset (bit 15)
      const val32 = (soundcntH << 16) | soundcntL;

      gba.mem.writeIO32(0x080, val32);

      expect(gba.apu.psgVolume).toBe(7);
      expect(gba.apu.fifoAVolume).toBe(1);
      expect(gba.apu.fifoAEnableRight).toBe(true);
      expect(gba.apu.fifoAEnableLeft).toBe(true);
      expect(gba.apu.fifoATimer).toBe(0);
    });

    it('clears FIFOs and sample latches on FIFO reset bits 11 & 15 (Bug 1.3)', () => {
      // Push some bytes to FIFO A and B
      gba.mem.writeIO32(0x0a0, 0x11223344);
      gba.mem.writeIO32(0x0a4, 0x55667788);

      // Trigger timer overflow to latch samples
      gba.mem.writeIO16(0x082, 0x3300); // Enable Sound A (L+R, Timer 0) and Sound B (L+R, Timer 0)
      gba.apu.onTimerOverflow(0);
      expect(gba.apu.sampleA).not.toBe(0);
      expect(gba.apu.sampleB).not.toBe(0);

      // Reset FIFO A via bit 11 (0x0800)
      gba.mem.writeIO16(0x082, 0x0800);
      expect(gba.apu.sampleA).toBe(0);

      // Reset FIFO B via bit 15 (0x8000)
      gba.mem.writeIO16(0x082, 0x8000);
      expect(gba.apu.sampleB).toBe(0);
    });
  });

  describe('Bug 1.4: 32-bit FIFO Data Writes', () => {
    it('pushes 4 bytes to FIFO A on 32-bit write to 0x0A0', () => {
      gba.mem.writeIO32(0x0a0, 0x44332211);
      // Enable Direct Sound A on Timer 0
      gba.mem.writeIO16(0x082, 0x0304); // Right+Left enable, Timer 0, vol 100%

      // Latch 1: should pop 0x11
      gba.apu.onTimerOverflow(0);
      expect(Math.round(gba.apu.sampleA * 128)).toBe(0x11);

      // Latch 2: should pop 0x22
      gba.apu.onTimerOverflow(0);
      expect(Math.round(gba.apu.sampleA * 128)).toBe(0x22);

      // Latch 3: should pop 0x33
      gba.apu.onTimerOverflow(0);
      expect(Math.round(gba.apu.sampleA * 128)).toBe(0x33);

      // Latch 4: should pop 0x44
      gba.apu.onTimerOverflow(0);
      expect(Math.round(gba.apu.sampleA * 128)).toBe(0x44);
    });

    it('pushes 4 bytes to FIFO B on 32-bit write to 0x0A4', () => {
      gba.mem.writeIO32(0x0a4, 0x40302010);
      gba.mem.writeIO16(0x082, 0x7008); // FIFO B Right+Left enable (bits 12-13), Timer 1 (bit 14), vol 100% (bit 3)

      // Latch 1 on Timer 1: should pop 0x10
      gba.apu.onTimerOverflow(1);
      expect(Math.round(gba.apu.sampleB * 128)).toBe(0x10);

      // Latch 2: should pop 0x20
      gba.apu.onTimerOverflow(1);
      expect(Math.round(gba.apu.sampleB * 128)).toBe(0x20);
    });
  });

  describe('Bug 1.5, 1.6, 1.7: Direct Sound Playback, Independence & Stereo Panning', () => {
    it('operates Direct Sound independently of SOUNDCNT_X master enable (Bug 1.6)', () => {
      // Disable masterEnable
      gba.mem.writeIO16(0x084, 0x0000);
      expect(gba.apu.masterEnable).toBe(false);

      // Configure Sound A to Left, Sound B to Right
      gba.mem.writeIO16(0x082, 0x120C); // A Left (bit 9), B Right (bit 12), vol 100% (bits 2,3)
      gba.mem.writeIO32(0x0a0, 0x00000040); // Sound A = +64 (0.5)
      gba.mem.writeIO32(0x0a4, 0x000000C0); // Sound B = -64 (-0.5)
      gba.apu.onTimerOverflow(0);

      // Tick APU for 1 sample period (512 cycles)
      gba.apu.tick(512);

      const out = new Float32Array(2);
      const read = gba.apu.readSamples(out, 2);
      expect(read).toBe(2);
      // Left channel should have Sound A (+0.5)
      expect(out[0]).toBeCloseTo(0.5, 2);
      // Right channel should have Sound B (-0.5)
      expect(out[1]).toBeCloseTo(-0.5, 2);
    });

    it('retains latched sample across multiple mixer produceSample cycles until next timer overflow (Bug 1.5)', () => {
      gba.mem.writeIO16(0x082, 0x0304); // Sound A L+R enable, Timer 0
      gba.mem.writeIO32(0x0a0, 0x00000020); // 1 sample = 0x20 (+0.25)
      gba.apu.onTimerOverflow(0); // Latch sample

      // Read 10 mixer samples without timer overflow; latched value must persist
      for (let i = 0; i < 10; i++) {
        gba.apu.tick(512);
        const out = new Float32Array(2);
        gba.apu.readSamples(out, 2);
        expect(out[0]).toBeCloseTo(0.25, 2);
        expect(out[1]).toBeCloseTo(0.25, 2);
      }
    });
  });

  describe('Bug 2.1: DMA Repeat Refills Advance Source Address', () => {
    it('advances internal SAD across multiple FIFO refills without replaying the first block', () => {
      // Setup audio buffer in EWRAM
      const soundDataAddr = 0x02001000;
      for (let i = 0; i < 32; i++) {
        gba.mem.write8(soundDataAddr + i, i + 1); // Bytes 1..32
      }

      // Configure DMA 1 for Sound FIFO A (dest 0x040000A0, start timing = 3, 32-bit, repeat, enable)
      // DMA1SAD = 0x0BC, DMA1DAD = 0x0C0, DMA1CNT_H = 0x0C6
      gba.mem.writeIO32(0x0bc, soundDataAddr);
      gba.mem.writeIO32(0x0c0, 0x040000a0);
      // DMA1CNT_H: start timing = 3 (bits 12-13 = 3 -> 0x3000), repeat = 1 (bit 9 = 0x200), enable = 1 (bit 15 = 0x8000)
      gba.mem.writeIO16(0x0c6, 0xb600);

      expect(gba.dmaInternalSad[1]).toBe(soundDataAddr);

      // Trigger first refill (e.g. FIFO A empty)
      gba.apu.dmaRequest!(0);

      // SAD should have advanced by 16 bytes (4 words)
      expect(gba.dmaInternalSad[1]).toBe(soundDataAddr + 16);

      // Trigger second refill
      gba.apu.dmaRequest!(0);

      // SAD should have advanced by another 16 bytes
      expect(gba.dmaInternalSad[1]).toBe(soundDataAddr + 32);

      // Verify that the APU FIFO received all 32 bytes in sequence
      gba.mem.writeIO16(0x082, 0x0304); // Timer 0, enable A L+R
      for (let i = 1; i <= 32; i++) {
        gba.apu.onTimerOverflow(0);
        expect(Math.round(gba.apu.sampleA * 128)).toBe(i);
      }
    });
  });

  describe('Bug 3.1 & 3.2: Memory & IO Integrity', () => {
    it('does not clobber adjacent registers on 8-bit IO writes (Bug 3.1)', () => {
      // Write 16-bit to 0x060
      gba.mem.writeIO16(0x060, 0x1234);
      // 8-bit write to odd register 0x061
      gba.mem.writeIO8(0x061, 0xAA);

      // Even register 0x060 must still hold 0x34, and 0x061 must hold 0xAA
      expect(gba.mem.readIO8(0x060)).toBe(0x34);
      expect(gba.mem.readIO8(0x061)).toBe(0xAA);
      expect(gba.mem.readIO16(0x060)).toBe(0xAA34);
    });

    it('masks write-only FIFO reset bits 11 and 15 on SOUNDCNT_H read (Bug 3.2)', () => {
      // Write with reset bits 11 and 15 set: 0x8800 | 0x0304 = 0x8B04
      gba.mem.writeIO16(0x082, 0x8B04);

      // Reading back SOUNDCNT_H must return bits 11 and 15 as 0 (masked by 0x770F)
      const readVal = gba.mem.readIO16(0x082);
      expect(readVal & 0x8800).toBe(0);
      expect(readVal).toBe(0x0304);
    });
  });

  describe('Bug 4.1 & 4.2: PSG Channel Frequency Periods and Register Offsets', () => {
    it('sets correct frequency period for SquareChannel: (2048 - freq) * 16', () => {
      gba.mem.writeIO16(0x084, 0x0080); // Master enable
      // Square 1: freq = 1048. Period = (2048 - 1048) * 16 = 16000 cycles
      // SOUND1CNT_H (0x062): envelope/volume = 0xF000
      gba.mem.writeIO16(0x062, 0xF000);
      // SOUND1CNT_X (0x064): freq = 1048, restart bit 15 = 0x8000 -> 0x8418
      gba.mem.writeIO16(0x064, 0x8418);

      expect(gba.apu.sq1.enable).toBe(true);
      expect(gba.apu.sq1.frequency).toBe(1048);

      // Step starts at 0
      const initialStep = gba.apu.sq1.step;
      // Tick 15999 cycles -> step should NOT advance
      gba.apu.sq1.tick(15999);
      expect(gba.apu.sq1.step).toBe(initialStep);
      // Tick 1 cycle (total 16000) -> step should advance by 1
      gba.apu.sq1.tick(1);
      expect(gba.apu.sq1.step).toBe((initialStep + 1) & 7);
    });

    it('sets correct frequency period for WaveChannel: (2048 - freq) * 8', () => {
      gba.mem.writeIO16(0x084, 0x0080); // Master enable
      // SOUND3CNT_L (0x070): enable bit 7 = 0x80
      gba.mem.writeIO16(0x070, 0x0080);
      // SOUND3CNT_H (0x072): volume 100% (bits 13-14 = 1 -> 0x2000)
      gba.mem.writeIO16(0x072, 0x2000);
      // SOUND3CNT_X (0x074): freq = 1048, restart bit 15 = 0x8000 -> 0x8418
      // Period = (2048 - 1048) * 8 = 8000 cycles
      gba.mem.writeIO16(0x074, 0x8418);

      expect(gba.apu.wave.enable).toBe(true);
      expect(gba.apu.wave.frequency).toBe(1048);

      const initialPos = gba.apu.wave.pos;
      gba.apu.wave.tick(7999);
      expect(gba.apu.wave.pos).toBe(initialPos);
      gba.apu.wave.tick(1);
      expect(gba.apu.wave.pos).toBe((initialPos + 1) & 31);
    });
  });

  describe('Bug 5.1: directBoot BIOS Audio Defaults', () => {
    it('initializes SOUNDCNT_X master enable and SOUNDBIAS in directBoot()', () => {
      gba.directBoot();

      expect(gba.mem.readIO16(0x084) & 0x0080).toBe(0x0080); // Master enable bit set
      expect(gba.apu.masterEnable).toBe(true);
      expect(gba.mem.readIO16(0x088)).toBe(0x0200); // SOUNDBIAS default 0x0200
    });
  });
});
