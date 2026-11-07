"""Pinned v1 score rules; finite/dimension validation fails closed."""
import enum
import numpy as np

class State(str, enum.Enum):
    PASS='PASS'; FAIL='FAIL'; MISSING='MISSING'; ERROR='ERROR'

def fuse(face, voice, challenge):
    return all(x is State.PASS for x in (face,voice,challenge))

def vector(value, dimension, normalize=False):
    a=np.asarray(value,dtype=float)
    if a.shape != (dimension,) or not np.isfinite(a).all() or np.linalg.norm(a)==0:
        raise ValueError('TEMPLATE_INVALID')
    return a/np.linalg.norm(a) if normalize else a

def scores(enrolled, probe):
    f=vector(enrolled['face']['embedding'],512)
    frames=[vector(x,512) for x in probe['face']['frames']]
    if not frames: raise ValueError('FACTOR_MISSING')
    fs=float(np.median([np.dot(f,x) for x in frames]))
    vs=float(vector(enrolled['voice']['embedding'],192,True) @ vector(probe['voice']['embedding'],192,True))
    return fs,vs

def verdict(score, threshold):
    if not np.isfinite(score): return State.ERROR
    return State.PASS if score>=threshold else State.FAIL

def aggregate(samples):
    if len(samples)!=3: raise ValueError('THREE_SAMPLES_REQUIRED')
    face=vector(np.mean([vector(x['face']['embedding'],512,True) for x in samples],axis=0),512,True)
    voice=vector(np.mean([vector(x['voice']['embedding'],192,True) for x in samples],axis=0),192,True)
    frames=[f for x in samples for f in x['face']['frames']]
    return {'version':2,'face':{'embedding':face.tolist(),'frames':frames,'n_frames':len(frames)},'voice':{'embedding':voice.tolist(),'model':'ecapa-voxceleb','n_samples':sum(x['voice']['n_samples'] for x in samples)}}
