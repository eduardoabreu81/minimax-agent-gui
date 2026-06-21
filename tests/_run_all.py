import subprocess, re, os
PY = r'C:\Users\Eduardo\AppData\Local\Programs\Python\Python310\python.exe'
CWD = r'C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui'
suites = [
    'test_music_phase1',
    'test_music_cover',
    'test_music_lyrics',
    'test_speech',
    'test_generation_defaults',
]
totals = {'OK': 0, 'FAIL': 0}
for s in suites:
    print(f'\n========== {s} ==========')
    r = subprocess.run([PY, f'tests/{s}.py'], capture_output=True, text=True, cwd=CWD)
    out = r.stdout + r.stderr
    out_clean = re.sub(r'\x1b\[[0-9;]*m', '', out)
    for l in out_clean.split('\n'):
        if 'INFO:httpx' in l or not l.strip():
            continue
        # Show only assertion lines and section headers
        if '[OK]' in l or '[FAIL]' in l or l.startswith('===') or l.startswith('All '):
            print(l)
    ok = len(re.findall(r'\[OK\]', out_clean))
    fail = len(re.findall(r'\[FAIL\]', out_clean))
    totals['OK'] += ok
    totals['FAIL'] += fail
    print(f'  --> {s}: {ok} OK / {fail} FAIL')

print(f"\n========== GRAND TOTAL ==========")
print(f"OK: {totals['OK']} / FAIL: {totals['FAIL']}")