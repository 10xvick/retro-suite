// PIA write to 0x1FF: addr&0x3FF = 0x1FF. Not < 0x80, not < 0x100.
// Falls into switch(addr & 0x3F) = 0x3F -> default (ignored!). That's the bug.
import { PIA } from '../src/atari/pia';
const pia = new PIA();
pia.write(0x1FF, 0xAB);
console.log('pia.write(0x1FF, AB) then read:', pia.read(0x1FF).toString(16));
