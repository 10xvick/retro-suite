import * as fs from 'fs';
import * as zlib from 'zlib';

export function saveBufferAsPng(width: number, height: number, buffer: Uint32Array, outPath: string) {
  const rawBytes = new Uint8Array(height * (width * 4 + 1));
  let srcIdx = 0;
  let dstIdx = 0;

  for (let y = 0; y < height; y++) {
    rawBytes[dstIdx++] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = buffer[srcIdx++];
      rawBytes[dstIdx++] = pixel & 0xff;         // R
      rawBytes[dstIdx++] = (pixel >> 8) & 0xff;  // G
      rawBytes[dstIdx++] = (pixel >> 16) & 0xff; // B
      rawBytes[dstIdx++] = (pixel >> 24) & 0xff; // A
    }
  }

  const compressed = zlib.deflateSync(rawBytes);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(outPath, png);
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crcBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = crc32(crcBuf);
  buf.writeUInt32BE(crc >>> 0, 8 + len);
  return buf;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xedb88320;
      else crc = crc >>> 1;
    }
  }
  return crc ^ 0xffffffff;
}
