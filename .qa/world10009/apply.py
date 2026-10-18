"""Apply the locally tested, checksum-pinned 0.1.10009 text delta on the isolated QA branch."""
import base64, hashlib, json, lzma, pathlib, subprocess
root=pathlib.Path.cwd()
parts=[root/'.qa/world10009'/f'part{i}.b64' for i in range(5)]
encoded=''.join(p.read_text().strip() for p in parts)
raw=lzma.decompress(base64.b64decode(encoded,validate=True))
assert hashlib.sha256(raw).hexdigest()=='33db8989e86397226474ca22cb54b16efacd8e8ac7adc47ec5aa32fa0aeca95c', 'Transport checksum mismatch'
patches=json.loads(raw)
assert len(patches)==43
names=[]
for entry in patches:
    name=entry['path']; path=root/name
    assert not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts
    assert name not in names and root in path.resolve().parents
    names.append(name)
    assert not name.startswith('public/audio/') and not name.endswith(('.png','.mp3','.exe','.zip'))
    current=path.read_bytes() if path.is_file() else None
    if current is not None and hashlib.sha256(current).hexdigest()==entry['after']: continue
    assert (hashlib.sha256(current).hexdigest() if current is not None else None)==entry['before'], 'Unexpected base: '+name
    text=current.decode('utf-8') if current is not None else ''
    for start,end,replacement in reversed(entry['ops']):
        assert 0<=start<=end<=len(text)
        text=text[:start]+replacement+text[end:]
    data=text.encode('utf-8')
    assert hashlib.sha256(data).hexdigest()==entry['after'], 'Patched checksum mismatch: '+name
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
(root/'.qa/world10009/changed-files.json').write_text(json.dumps(names))
print('Verified and applied',len(names),'source/document/test files. User audio and legacy textures were not modified.')
