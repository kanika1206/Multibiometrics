import os,sys,ctypes
from ctypes import wintypes

_network_attempts=[]

def network_attempts():return tuple(_network_attempts)

def deny_network():
    def guard(event,args):
        if event.startswith('socket.'):
            _network_attempts.append(event)
            raise PermissionError('NETWORK_FORBIDDEN')
    sys.addaudithook(guard)
    # urllib3 imports perform an IPv6 capability probe if this is true.
    # This offline process has no IPv6 use; disable the probe BEFORE imports.
    # Socket constructors remain real and guarded, never mocked or whitelisted.
    import socket
    socket.has_ipv6=False
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1',OPENCV_FFMPEG_CAPTURE_OPTIONS='protocol_whitelist;file,pipe')
    # Python audit hook is defense in depth, not a native-DLL network sandbox.

class DPAPI:
    def __init__(self):
        if os.name!='nt':raise RuntimeError('UNVERIFIED-ON-TARGET: Windows DPAPI required')
    def _run(self,data,protect):
        class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
        buf=(ctypes.c_ubyte*len(data)).from_buffer_copy(data);src=Blob(len(data),buf);dst=Blob()
        dll=ctypes.WinDLL('crypt32',use_last_error=True)
        fn=dll.CryptProtectData if protect else dll.CryptUnprotectData
        fn.restype=wintypes.BOOL
        fn.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
        if not fn(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)):raise RuntimeError('KEY_UNAVAILABLE')
        try:return ctypes.string_at(dst.data,dst.size)
        finally:
            kernel=ctypes.WinDLL('kernel32');kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
            kernel.LocalFree(dst.data)
    def wrap(self,data):return self._run(data,True)
    def unwrap(self,data):return self._run(data,False)

class WindowsStateLock:
    """One verifier owns the state directory; lifetime tied to this process."""
    def __init__(self,directory):
        if os.name!='nt':raise RuntimeError('NOT_READY: Windows lock required')
        import msvcrt
        from pathlib import Path
        self.file=open(Path(directory)/'instance.lock','a+b')
        self.file.seek(0)
        if not self.file.read(1):self.file.write(b'0');self.file.flush()
        self.file.seek(0)
        try:msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:self.file.close();raise RuntimeError('NOT_READY: another verifier owns state')
    def close(self):self.file.close()

def restrict_windows_directory(directory):
    """Set current-user-only inheritance before storing secrets; target verification required."""
    if os.name!='nt':raise RuntimeError('NOT_READY: Windows ACL required')
    import subprocess,csv,io
    result=subprocess.run(['whoami','/user','/fo','csv','/nh'],capture_output=True,text=True,check=True,timeout=10)
    sid=next(csv.reader(io.StringIO(result.stdout)))[1]
    if not sid.startswith('S-1-'):raise RuntimeError('NOT_READY: user SID')
    subprocess.run(['icacls',str(directory),'/inheritance:r','/grant:r',f'*{sid}:(OI)(CI)F'],capture_output=True,check=True,timeout=10)

def install_power_hook(root,on_power_change):
    """Invalidate on suspend/resume messages; Windows-only and target-unverified."""
    if os.name!='nt':raise RuntimeError('NOT_READY: Windows power hook required')
    user=ctypes.WinDLL('user32',use_last_error=True)
    intptr=ctypes.c_ssize_t
    proc_type=ctypes.WINFUNCTYPE(intptr,wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM)
    user.GetParent.argtypes=[wintypes.HWND];user.GetParent.restype=wintypes.HWND
    user.SetWindowLongPtrW.argtypes=[wintypes.HWND,ctypes.c_int,intptr];user.SetWindowLongPtrW.restype=intptr
    user.CallWindowProcW.argtypes=[intptr,wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM];user.CallWindowProcW.restype=intptr
    root.update_idletasks();hwnd=user.GetParent(root.winfo_id()) or root.winfo_id();old=0
    def handler(window,message,wparam,lparam):
        if message==0x218 and wparam in (4,7,18):on_power_change()
        return user.CallWindowProcW(old,window,message,wparam,lparam)
    callback=proc_type(handler)
    old=user.SetWindowLongPtrW(hwnd,-4,ctypes.cast(callback,ctypes.c_void_p).value)
    if not old:raise RuntimeError('NOT_READY: power notification hook failed')
    # Retain ctypes callback for the lifetime of the window.
    root._power_hook_callback=callback
