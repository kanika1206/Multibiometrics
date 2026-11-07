"""Persistent local inference. Explicit model files only; no model-hub resolution.
ECAPA graph must accept the full mono 16kHz waveform INCLUDING its original
feature preprocessing, and output 192-d embeddings. Unqualified exports fail readiness.
"""
from pathlib import Path
import subprocess,json
import numpy as np
from .asr import LocalASR
from .contracts import vector
class LocalInference:
    def __init__(self,assets,transient):
        self.directory=Path(transient).resolve();self.directory.mkdir(parents=True,exist_ok=True)
        self.ffmpeg=str(assets.require('ffmpeg'));self.ffprobe=str(assets.require('ffprobe'))
        required=['face_detector','face_recognizer','speaker_waveform']
        paths={key:assets.require(key) for key in required}
        if assets.manifest.get('speaker_contract')!='mono-16khz-waveform-in-192-out':raise RuntimeError('ASSET_INVALID: speaker export contract')
        assets.require_parity()
        try:
            import onnxruntime as ort
            from insightface.model_zoo import get_model
        except ImportError as e:raise RuntimeError('ASSET_MISSING: inference runtime') from e
        self.det=get_model(str(paths['face_detector']),providers=['CPUExecutionProvider'])
        self.face=get_model(str(paths['face_recognizer']),providers=['CPUExecutionProvider'])
        self.det.prepare(ctx_id=-1,input_size=(640,640));self.face.prepare(ctx_id=-1)
        ort.disable_telemetry_events()
        options=ort.SessionOptions();options.enable_profiling=False
        self.speaker=ort.InferenceSession(str(paths['speaker_waveform']),options,providers=['CPUExecutionProvider'])
        if len(self.speaker.get_inputs())!=1:raise RuntimeError('ASSET_INVALID: speaker input')
        assets.require('vosk_config')
        model_dir=(assets.root/assets.manifest['vosk_model_dir']).resolve()
        if not model_dir.is_relative_to(assets.root):raise RuntimeError('ASSET_INVALID: ASR path')
        self.asr=LocalASR(model_dir)
        self.metadata={}
    def _path(self,handle):
        p=Path(handle).resolve()
        if not p.is_relative_to(self.directory) or not p.is_file():raise ValueError('CAPTURE_INVALID')
        return p
    def extract(self,handle,enrollment=False):
        import cv2
        path=self._path(handle)
        info=subprocess.run([self.ffprobe,'-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',str(path)],capture_output=True,check=True,timeout=10)
        self.metadata[str(path)]=json.loads(info.stdout) # retained only in memory, preserves track offsets
        cap=cv2.VideoCapture(str(path));frames=[];areas=[]
        try:
            if not cap.isOpened():raise ValueError('CAPTURE_INVALID')
            total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            def take(frame):
                boxes,kps=self.det.detect(frame,max_num=0,metric='default')
                if len(boxes)==0:return
                i=int(np.argmax((boxes[:,2]-boxes[:,0])*(boxes[:,3]-boxes[:,1])))
                f=type('FaceInput',(),{})();f.kps=kps[i]
                self.face.get(frame,f)
                frames.append(vector(f.embedding,512,True).tolist());areas.append(float((boxes[i,2]-boxes[i,0])*(boxes[i,3]-boxes[i,1])))
            if total>0:
                for idx in np.linspace(0,total-1,num=min(12,total),dtype=int):
                    cap.set(cv2.CAP_PROP_POS_FRAMES,int(idx));ok,frame=cap.read()
                    if ok:take(frame)
            else:
                i=0
                while len(frames)<12:
                    ok,frame=cap.read()
                    if not ok:break
                    if i%5==0:take(frame)
                    i+=1
        finally:cap.release()
        if not frames:raise ValueError('FACTOR_MISSING')
        if enrollment and sum(a>=6400 for a in areas)<6:raise ValueError('QUALITY_FACE')
        pcm=subprocess.run([self.ffmpeg,'-v','error','-protocol_whitelist','file,pipe','-i',str(path),'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],capture_output=True,check=True,timeout=30).stdout
        wave=np.frombuffer(pcm,dtype='<i2').astype(np.float32)/32768.0
        if wave.size<16000 or not np.isfinite(wave).all() or not np.any(wave):raise ValueError('QUALITY_AUDIO')
        emb=self.speaker.run(None,{self.speaker.get_inputs()[0].name:wave[None,:]})[0]
        voice=vector(np.asarray(emb).reshape(-1),192,True)
        face=vector(np.mean(frames,axis=0),512,True)
        doc={'version':2,'face':{'embedding':face.tolist(),'frames':frames,'n_frames':len(frames)},'voice':{'embedding':voice.tolist(),'model':'ecapa-voxceleb','n_samples':int(wave.size)}}
        return doc,self.asr.transcribe(pcm)
    def cleanup(self,handle):
        path=Path(handle).resolve()
        if not path.is_relative_to(self.directory):raise ValueError('CAPTURE_INVALID')
        path.unlink(missing_ok=True);self.metadata.pop(str(path),None)
