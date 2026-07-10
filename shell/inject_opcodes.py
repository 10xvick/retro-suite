with open("opcodes_to_add.ts", "r") as f:
    new_opcodes = f.read()

with open("src/emulator/audio/Spc700.ts", "r") as f:
    code = f.read()

# find `default:`
code = code.replace("      default:", new_opcodes + "\n      default:")

with open("src/emulator/audio/Spc700.ts", "w") as f:
    f.write(code)

print("Injected new opcodes!")
