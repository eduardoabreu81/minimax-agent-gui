import subprocess
r = subprocess.run(
    ['python', 'tests/test_speech.py'],
    capture_output=True, text=True,
    cwd=r'C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui',
)
out = r.stdout + r.stderr
import re
ansi = re.compile(r'\x1b\[[0-9;]*m')
out = ansi.sub('', out)
lines = [l for l in out.split('\n') if 'OK' in l or 'FAIL' in l or 'All speech' in l or '===' in l]
for l in lines:
    print(l)
ok = sum(1 for l in lines if '[OK]' in l)
fail = sum(1 for l in lines if '[FAIL]' in l)
print(f'TOTAL OK: {ok}')
print(f'TOTAL FAIL: {fail}')