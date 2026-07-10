import urllib.request
import json

# Download a known opcode table from internet or define them
# Actually, I can just curl an SPC700 opcode table or use a small script.
# Let's just define the ones I need based on patterns:

# 0x0B: ASL dp (Wait, ASL dp is 0x0B in SPC700? Let's check: 
# 0x0A: OR1 C, mem.bit, 0x0B: ASL dp
# 0x0C: ASL abs
# 0x0E: TSET1 abs
# 0x17: INC A (No, 0xBC is INC A. 0x17 is OR A, (X)+?)
