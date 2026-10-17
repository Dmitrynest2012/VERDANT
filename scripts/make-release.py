#!/usr/bin/env python3
"""Only CI release packaging; flat source ZIP + separate original 1K textures."""
import hashlib, json, pathlib, zipfile
root=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((root/'scripts/release-files.json').read_text(encoding='utf-8'))
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
assert manifest['version']==version
output=[]
project=root/f'VERDANT_v{version}_PROJECT.zip'
with zipfile.ZipFile(project,'w',zipfile.ZIP_DEFLATED,compresslevel=8) as z:
    for name in manifest['files']:
        f=root/name
        if not f.is_file():raise SystemExit(f'Missing project file {name}')
        if name.lower().endswith(('.png','.jpg','.jpeg','.mp3')):raise SystemExit('Asset in code ZIP')
        z.write(f,name)
output.append(project)
textures=root/f'VERDANT_v{version}_TEXTURES_1K.zip'
with zipfile.ZipFile(textures,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for f in sorted((root/'public/textures').glob('*.png')):
        if f.name=='cloud_volume.png':continue # unused legacy asset
        z.write(f,f.name)
    z.write(root/'public/textures/README.md','README.md')
output.append(textures)
with (root/'SHA256SUMS.txt').open('w',encoding='utf-8') as f:
    for item in output:
        f.write(hashlib.sha256(item.read_bytes()).hexdigest()+'  '+item.name+'\n')
print('Release assets:',*[p.name for p in output])
