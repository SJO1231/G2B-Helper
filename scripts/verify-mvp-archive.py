# Checks the packaged MVP ZIP against dist/ (former harness command mvp-archive-test).
from pathlib import Path
import zipfile
p=Path('dist/G2B_Helper_MVP.zip')
z=zipfile.ZipFile(p)
names=z.namelist()
assert z.testzip() is None
assert {'설치안내.txt','mvp-extension/manifest.json','mvp-extension/main.html','mvp-extension/background.js','mvp-host/G2BHelperHost/G2BHelperHost.exe','mvp-host/install-mvp-host.ps1'}.issubset(names)
assert any(n.startswith('mvp-host/G2BHelperHost/_internal/') for n in names)
assert not any(any(s in n for s in ['참고자료','prototypes','data_map_','.sqlite']) for n in names)
assert all(z.read(n)==(Path('dist/mvp-host/feedback')/n.removeprefix('mvp-host/') if n.startswith('mvp-host/G2BHelperHost/') else Path('dist')/n).read_bytes() for n in names if n!='설치안내.txt')
assert '설치' in z.read('설치안내.txt').decode('utf-8')
print('Verified ZIP CRC, file identity, runtime and install guide:',len(names),'entries,',p.stat().st_size,'bytes')
z.close()
