import sys,traceback,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));events=[]
def hook(event,args):
 if event.startswith('socket.'):
  events.append({'event':event,'stack':traceback.format_stack()});raise PermissionError('NETWORK_FORBIDDEN')
sys.addaudithook(hook)
for name in ['numpy','cv2','onnxruntime','insightface.model_zoo','vosk']:
 try:__import__(name)
 except Exception as e:print(name,type(e).__name__)
(ROOT/'evidence/import-network-audit.json').write_text(json.dumps(events,indent=2));print('events',len(events))
