"""Fixed target preflight; generated inputs only; never grants a session."""
import sys,os,json,subprocess,secrets,contextlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network,DPAPI,network_attempts
deny_network()
if os.name!='nt' or len(sys.argv)!=1:raise SystemExit('Windows preflight takes no options')
from core.acceptance import create_run,finish_run,run_directory,CandidateAssets
from core.inference import LocalInference
from core.asr import accept
from core.contracts import State
from core.assets import Assets
import tkinter as tk
import numpy as np
run_id=create_run(ROOT);directory=run_directory(run_id);report={'status':'FAILED','run_id':run_id,'kind':'PREFLIGHT_ONLY_NOT_ACCEPTANCE'}
try:
    ui=tk.Tk();ui.withdraw();report['tk_version']=ui.tk.call('info','patchlevel');ui.destroy()
    try:Assets(ROOT/'assets')
    except RuntimeError:report['production_gate_rejects']=True
    else:raise RuntimeError('Production gate unexpectedly open on candidate')
    dp=DPAPI();key=secrets.token_bytes(32);wrapped=dp.wrap(key)
    if dp.unwrap(wrapped)!=key:raise RuntimeError('DPAPI roundtrip')
    report['dpapi_roundtrip']=True
    assets=CandidateAssets(ROOT/'assets')
    with contextlib.redirect_stdout(sys.stderr):engine=LocalInference(assets,directory/'state/transient')
    for name in ('ffmpeg','ffprobe'):
        result=subprocess.run([str(assets.require(name)),'-version'],capture_output=True,text=True,check=True,timeout=20)
        report[name]=result.stdout.splitlines()[0]
    devices=subprocess.run([str(assets.require('ffmpeg')),'-hide_banner','-list_devices','true','-f','dshow','-i','dummy'],capture_output=True,text=True,timeout=20)
    (directory/'capture-devices.txt').write_text(devices.stderr)
    boxes,_=engine.det.detect(np.zeros((480,640,3),dtype=np.uint8),max_num=0,metric='default')
    if len(boxes):raise RuntimeError('Blank image detected face')
    candidates=engine.asr.transcribe(bytes(32000))
    if accept(candidates,'01234') is State.PASS:raise RuntimeError('Silence accepted')
    emb=engine.speaker.run(None,{'waveform':np.random.default_rng(1).normal(0,.05,(1,16000)).astype('float32')})[0]
    if emb.shape!=(1,192) or not np.isfinite(emb).all():raise RuntimeError('Speaker graph shape')
    if network_attempts():raise RuntimeError('NETWORK_FORBIDDEN')
    report.update(status='PREFLIGHT_PASS_ONLY',speaker_shape=list(emb.shape),python_socket_attempts=list(network_attempts()))
finally:
    (directory/'preflight.json').write_text(json.dumps(report,indent=2))
    finish_run(run_id,False)
    print(directory)
