"""Generated audio only; isolate decoder parity from identity/enrollment effects."""
from pathlib import Path
import wave,subprocess,json,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from core.security import deny_network
deny_network()
import librosa
work=ROOT/'tmp/preprocessing';work.mkdir(parents=True,exist_ok=True)
ffmpeg=str(ROOT/'assets/linux-tools/ffmpeg');rows=[]
for rate,channels in [(16000,1),(44100,2),(48000,1)]:
 source=work/f'{rate}-{channels}.wav';dest=work/'reference.wav'
 samples=np.random.default_rng(rate).integers(-12000,12000,(rate*2,channels),dtype=np.int16)
 with wave.open(str(source),'wb') as w:w.setnchannels(channels);w.setsampwidth(2);w.setframerate(rate);w.writeframes(samples.tobytes())
 subprocess.run([ffmpeg,'-v','error','-y','-i',str(source),'-ac','1','-ar','16000',str(dest)],check=True)
 reference,_=librosa.load(str(dest),sr=16000,mono=True)
 pcm=subprocess.run([ffmpeg,'-v','error','-i',str(source),'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],capture_output=True,check=True).stdout
 actual=np.frombuffer(pcm,dtype='<i2').astype(np.float32)/32768.
 equal=bool(np.array_equal(reference,actual));rows.append({'source_rate':rate,'source_channels':channels,'exact_array_equal':equal,'sample_count':actual.size})
 if not equal:raise RuntimeError('PREPROCESSING_PARITY_FAILED')
report={'status':'GENERATED_AUDIO_PARITY_PASS','rows':rows,'limitations':'Same Linux ffmpeg binary; not Windows codec/capture or real-media parity. New enrollment remains distinct from v1.'}
(ROOT/'evidence/preprocessing-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
