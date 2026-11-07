"""Allowlisted diagnostics: never return raw exception text containing media/secrets."""
CODES={'NETWORK_FORBIDDEN','CONTENT_TOO_LARGE','ASSET_MISSING','ASSET_INVALID','NOT_READY','TEMPLATE_INVALID','KEY_UNAVAILABLE','IDENTITY_UNKNOWN','IDENTITY_EXISTS','CAPTURE_INVALID','CAPTURE_MISSING','CAPTURE_BUSY','FACT_OR_MISSING','FACTOR_MISSING','INFERENCE_ERROR','INFERENCE_TIMEOUT','CANCELLED','STORAGE_ERROR','ASR_AMBIGUOUS','CHALLENGE_EXPIRED_OR_CLOCK_ANOMALY','ATTEMPT_REPLAY','REAUTHENTICATION_REQUIRED','SESSION_LOCKED','ENROLLMENT_STATE','QUALITY_FACE','QUALITY_AUDIO','IPC_INVALID','RESEARCH_CONSENT_REQUIRED'}
def code(exc):
    prefix=str(exc).split(':',1)[0]
    return prefix if prefix in CODES else 'INFERENCE_ERROR'

_COMPONENTS={'Vosk model','Vosk runtime','inference runtime','qualified offline release manifest','speaker export contract','model parity evidence absent','face_detector','face_recognizer','speaker_waveform','ffmpeg','ffprobe','vosk_config'}
def diagnostic(exc):
    status=code(exc);suffix=str(exc).split(':',1)[1].strip() if ':' in str(exc) else ''
    component=suffix if suffix in _COMPONENTS else None
    messages={'ASSET_MISSING':'Required offline component is missing. Reprovision locally; no download will be attempted.','ASSET_INVALID':'Offline component integrity or compatibility check failed.','KEY_UNAVAILABLE':'Windows key protection is unavailable. Administrator delete-and-re-enroll recovery may be required.','NOT_READY':'This package is not qualified for authentication.','INFERENCE_TIMEOUT':'Verification timed out. The session is locked; start a fresh attempt.','CANCELLED':'Attempt cancelled; the session is locked.','NETWORK_FORBIDDEN':'A forbidden socket attempt was blocked. Authentication is disabled for this worker.'}
    result={'status':status,'message':messages.get(status,status.replace('_',' ').capitalize())}
    if component:result['component']=component;result['message']+=' Component: '+component+'.'
    return result
