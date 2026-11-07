"""No network engine. Expected digits never enter decoder configuration."""
import json
import itertools
from pathlib import Path
from .contracts import State
WORDS=dict(zip('zero one two three four five six seven eight nine'.split(),'0123456789'))
def normalize(text):
    tokens=text.lower().split()
    if len(tokens)!=5:return None
    out=[]
    for t in tokens:
        if t in WORDS:out.append(WORDS[t])
        elif len(t)==1 and t in '0123456789':out.append(t)
        else:return None
    return ''.join(out)
def accept(alternatives,expected,final=True):
    if not final or not alternatives:return State.FAIL
    top=normalize(alternatives[0])
    if top is None:return State.FAIL
    distinct={normalize(x) for x in alternatives};distinct.discard(None)
    if len(distinct)>1:return State.FAIL
    return State.PASS if top==expected else State.FAIL
class LocalASR:
    def __init__(self,path):
        if not Path(path).is_dir():raise RuntimeError('ASSET_MISSING: Vosk model')
        try:
            from vosk import Model,SetLogLevel
        except ImportError as e:raise RuntimeError('ASSET_MISSING: Vosk runtime') from e
        SetLogLevel(-1)
        try:self.model=Model(str(path))
        except Exception as e:raise RuntimeError('ASSET_INVALID: Vosk model') from e
    def transcribe(self,pcm16):
        from vosk import KaldiRecognizer
        rec=KaldiRecognizer(self.model,16000,json.dumps(list(WORDS)+['[unk]']))
        rec.SetMaxAlternatives(5)
        # Segment alternatives are combined in decoder order. Never discard speech.
        segments=[]
        for i in range(0,len(pcm16),8000):
            if rec.AcceptWaveform(pcm16[i:i+8000]):segments.append(json.loads(rec.Result()))
        segments.append(json.loads(rec.FinalResult()))
        return combine_segments(segments)

def combine_segments(segments, limit=4096):
    groups=[]
    for segment in segments:
        alts=segment.get('alternatives')
        texts=[str(x.get('text','')) for x in alts] if alts else [str(segment.get('text',''))]
        # A truly empty endpoint is silence. A blank top with nonblank alternatives
        # is NOT skipped: its top reading remains invalid in the whole utterance.
        if not any(t.strip() for t in texts):continue
        groups.append(texts)
    if not groups:return []
    count=1
    for group in groups:
        count*=len(group)
        if count>limit:raise ValueError('ASR_AMBIGUOUS')
    # First tuple uses each segment's top-ranked reading. Every valid alternative
    # is retained for ambiguity rejection; no truncation that could hide one.
    return [' '.join(parts) for parts in itertools.product(*groups)]
