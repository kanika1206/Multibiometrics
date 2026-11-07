"""Real pretrained models, generated input only. No release qualification."""
import sys,json,contextlib,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network,network_attempts
deny_network()
from core.assets import Assets
from core.inference import LocalInference
from core.asr import accept
import numpy as np
with contextlib.redirect_stdout(sys.stderr):
 engine=LocalInference(Assets(ROOT/'assets',development=True),ROOT/'tmp/inference')
 boxes,_=engine.det.detect(np.zeros((480,640,3),dtype=np.uint8),max_num=0,metric='default')
 candidates=engine.asr.transcribe(bytes(32000))
 emb=engine.speaker.run(None,{'waveform':np.random.default_rng(1).normal(0,.05,(1,16000)).astype('float32')})[0]
 media=ROOT/'tmp/inference/generated-no-face.mkv'
 subprocess.run([engine.ffmpeg,'-v','error','-y','-f','lavfi','-i','color=c=black:s=320x240:r=12','-f','lavfi','-i','anoisesrc=r=16000','-t','1','-c:v','ffv1','-c:a','pcm_s16le',str(media)],check=True,timeout=15)
 try:
  engine.extract(str(media));failure='UNEXPECTED_SUCCESS'
 except ValueError as e:failure=str(e)
 finally:engine.cleanup(str(media))
report={'status':'REAL_MODELS_SYNTHETIC_SMOKE_ONLY','blank_face_count':len(boxes),'silence_challenge':accept(candidates,'01234').value,'speaker_shape':list(emb.shape),'speaker_finite':bool(np.isfinite(emb).all()),'generated_media_result':failure,'generated_media_removed':not media.exists(),'python_socket_audit_events':list(network_attempts()),'limits':'No Windows, real-speaker accuracy, native network audit or release qualification.'}
(ROOT/'evidence/real-model-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if report['python_socket_audit_events']:raise SystemExit('NETWORK_ATTEMPT')
