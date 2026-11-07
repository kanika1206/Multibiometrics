"""Installed layout. No migration, portable-state fallback, or environment override."""
import os,ctypes
from pathlib import Path
NAMES=('vault','logs','transient','research-capture','acceptance-evidence')
def windows_state_root():
    if os.name!='nt':raise RuntimeError('NOT_READY: Windows required')
    buf=ctypes.create_unicode_buffer(32768)
    fn=ctypes.WinDLL('shell32').SHGetFolderPathW
    fn.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint,ctypes.c_wchar_p]
    fn.restype=ctypes.c_long
    if fn(None,28,None,0,buf)!=0 or not buf.value:raise RuntimeError('STORAGE_ERROR')
    # CSIDL_LOCAL_APPDATA = 0x1c; OS resolves current interactive Windows user.
    return Path(buf.value)/'MultimodalOffline'
def prepare_state(root,restrict):
    root=Path(root)
    if not root.is_absolute():raise RuntimeError('STORAGE_ERROR')
    for p in (root,*[root/n for n in NAMES]):
        if p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()):raise RuntimeError('STORAGE_ERROR')
        p.mkdir(parents=True,exist_ok=True);restrict(p)
    return {name:root/name for name in NAMES}
