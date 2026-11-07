import json
MAX_BYTES=65536
def read(stream):
    line=stream.readline(MAX_BYTES+1)
    if not line:return None
    if len(line)>MAX_BYTES or not line.endswith(b'\n'):raise ValueError('IPC_INVALID')
    value=json.loads(line)
    if not isinstance(value,dict) or not isinstance(value.get('id'),str) or len(value['id'])>128:raise ValueError('IPC_INVALID')
    return value
def write(stream,value):
    data=json.dumps(value,allow_nan=False,separators=(',',':')).encode()+b'\n'
    if len(data)>MAX_BYTES:raise ValueError('IPC_INVALID')
    stream.write(data);stream.flush()
