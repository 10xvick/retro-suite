import urllib.request
url = "https://raw.githubusercontent.com/snes9xgit/snes9x/master/apu/spc700.cpp"
try:
    data = urllib.request.urlopen(url).read().decode('utf-8')
    for i, line in enumerate(data.split('\n')):
        if 'case 0xb8' in line.lower() or 'case 0x18' in line.lower():
            print(data.split('\n')[i:i+3])
except Exception as e:
    print(e)
