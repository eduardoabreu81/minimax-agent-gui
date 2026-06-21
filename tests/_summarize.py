import subprocess, re
r = subprocess.run(
    [r'C:\Users\Eduardo\AppData\Local\Programs\Python\Python310\python.exe', 'tests/test_generation_defaults.py'],
    capture_output=True, text=True,
    cwd=r'C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui',
)
out = r.stdout + r.stderr
out_clean = re.sub(r'\x1b\[[0-9;]*m', '', out)
for l in out_clean.split('\n'):
    if 'INFO:httpx' in l:
        continue
    if l.strip():
        print(l)
ok = len(re.findall(r'\[OK\]', out_clean))
fail = len(re.findall(r'\[FAIL\]', out_clean))
print(f'\nTOTAL OK: {ok}')
print(f'TOTAL FAIL: {fail}')