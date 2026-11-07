"""Inventory existing isolated dependencies and assets; never fetches or installs."""
from pathlib import Path
import hashlib,json,importlib.metadata as metadata
ROOT=Path(__file__).resolve().parents[1]
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def main():
    old=json.loads((ROOT/'provisioning-manifest.json').read_text())
    rows={r['path']:r for r in old['files'] if (ROOT/r['path']).is_file() and not r['path'].startswith(('.venv/','export-env/'))}
    for env in ('.venv','export-env'):
        for dist in metadata.distributions(path=[str(ROOT/env/'lib/python3.12/site-packages')]):
            name=dist.metadata['Name'];version=dist.version
            for entry in dist.files or []:
                p=Path(dist.locate_file(entry)).absolute()
                if not p.is_file() or p.suffix=='.pyc':continue
                try:relative=p.relative_to(ROOT).as_posix()
                except ValueError:raise RuntimeError('Dependency outside package: '+str(p))
                rows[relative]={'name':name,'version':version,'source':f'https://pypi.org/project/{name}/{version}/','path':relative,'sha256':sha(p),'role':'Linux development only; installed local copy, not Windows release'}
    for p in (ROOT/'assets').rglob('*'):
        if not p.is_file() or p.suffix=='.json':continue
        relative=p.relative_to(ROOT).as_posix()
        if relative in rows:continue
        if 'vosk' in relative: name,version,source='vosk-model-small-en-us','0.15','https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
        elif p.name=='ecapa-waveform.onnx':name,version,source='ECAPA waveform export','opset17; SHA version','local tools/export_ecapa.py from assets/ecapa-source/embedding_model.ckpt'
        elif 'linux-tools' in relative:name,version,source=p.name,'local binary SHA version','read-only copy /usr/bin/'+p.name
        else:name,version,source=p.name,'SHA version','local pretrained asset; assets/source-assets.json'
        rows[relative]={'name':name,'version':version,'source':source,'path':relative,'sha256':sha(p),'role':'development asset; not qualified for release'}
    for row in rows.values():row['sha256']=sha(ROOT/row['path'])
    result={'schema':'P1-PROVISION-2','status':'DEVELOPMENT_ONLY_NOT_QUALIFIED','files':sorted(rows.values(),key=lambda r:r['path']),'limitations':'Linux binaries retain OS shared-library dependencies. Windows runtime, Tk, codecs and complete standalone closure remain unprovisioned. Historical copy provenance retained in evidence/*dependencies.json.'}
    target=ROOT/'provisioning-manifest.json';target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'files':len(rows),'manifest_sha256':sha(target)}))
if __name__=='__main__':main()
