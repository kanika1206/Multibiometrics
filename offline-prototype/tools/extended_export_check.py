import sys,json,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('local_export',ROOT/'tools/export_ecapa.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
import torch,numpy as np,onnxruntime as ort
ort.disable_telemetry_events();opts=ort.SessionOptions();opts.intra_op_num_threads=4
session=ort.InferenceSession(str(ROOT/'assets/ecapa-waveform.onnx'),opts,providers=['CPUExecutionProvider']);reference=module.Model().eval();rows=[]
with torch.no_grad():
 for length in [16001,32137,96001,320000]:
  t=torch.arange(length)/16000.;wave=(.04*torch.sin(2*torch.pi*137*t)+.01*torch.randn(length)).reshape(1,-1)
  a=reference(wave);b=torch.from_numpy(session.run(None,{'waveform':wave.numpy()})[0]);cos=float(torch.nn.functional.cosine_similarity(a,b).item())
  rows.append({'samples':length,'cosine':cos,'pass':cos>.99})
report={'status':'SYNTHETIC_DYNAMIC_LENGTH_PASS' if all(r['pass'] for r in rows) else 'FAIL','rows':rows,'limitations':'Generated signals, not real speakers; no target or FAR/FRR claim'}
(ROOT/'evidence/ecapa-dynamic-length.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if report['status']=='FAIL':raise SystemExit(1)
