import re

with open("src/emulator/audio/Spc700.ts", "r") as f:
    code = f.read()

# Add getDpAddr method if not exists
if "public getDpAddr(" not in code:
    code = code.replace(
        "public readByte(addr: number): number {",
        "public getDpAddr(offset: number): number {\n    return (this.state.psw & 0x20 ? 0x100 : 0) + (offset & 0xFF);\n  }\n\n  public readByte(addr: number): number {"
    )

# Fix readByte(dp) -> readByte(this.getDpAddr(dp))
# We need to be careful. The variable is usually `dp`.
# Sometimes it's `dp + this.state.x` or `dp + this.state.y`.
# We'll use regex to find `readByte(...)` where ... contains `dp`.
# Actually, the easiest is to just find specific patterns.
code = re.sub(r'this\.readByte\(dp\)', r'this.readByte(this.getDpAddr(dp))', code)
code = re.sub(r'this\.writeByte\(dp,', r'this.writeByte(this.getDpAddr(dp),', code)

code = re.sub(r'this\.readByte\(\(dp \+ this\.state\.x\) & 0xFF\)', r'this.readByte(this.getDpAddr(dp + this.state.x))', code)
code = re.sub(r'this\.writeByte\(\(dp \+ this\.state\.x\) & 0xFF,', r'this.writeByte(this.getDpAddr(dp + this.state.x),', code)

code = re.sub(r'this\.readByte\(\(dp \+ this\.state\.y\) & 0xFF\)', r'this.readByte(this.getDpAddr(dp + this.state.y))', code)
code = re.sub(r'this\.writeByte\(\(dp \+ this\.state\.y\) & 0xFF,', r'this.writeByte(this.getDpAddr(dp + this.state.y),', code)

with open("src/emulator/audio/Spc700.ts", "w") as f:
    f.write(code)
print("Done patching DP!")
