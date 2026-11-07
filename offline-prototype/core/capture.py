"""Windows DirectShow capture adapter; UNVERIFIED-ON-TARGET."""
import os,subprocess,secrets,json
class WindowsCapture:
    def __init__(self,ffmpeg,ffprobe,directory):
        if os.name!='nt':raise RuntimeError('UNVERIFIED-ON-TARGET: Windows capture required')
        self.ffmpeg=str(ffmpeg);self.ffprobe=str(ffprobe);self.directory=directory;self.running=None
    def start(self,camera,microphone):
        if self.running:raise ValueError('CAPTURE_BUSY')
        if not camera or not microphone or any(c in camera+microphone for c in ['\n','\r','\x00']):raise ValueError('CAPTURE_INVALID')
        path=self.directory/(secrets.token_hex(16)+'.mkv')
        # No shell, no network input; preserve common source timing in container.
        self.running=(path,subprocess.Popen([self.ffmpeg,'-hide_banner','-loglevel','error','-f','dshow','-i',f'video={camera}:audio={microphone}','-t','60','-c:v','ffv1','-c:a','pcm_s16le',str(path)],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE))
        return str(path)
    def stop(self):
        if not self.running:raise ValueError('CAPTURE_MISSING')
        path,p=self.running;self.running=None
        try:
            _,err=p.communicate(b'q\n',timeout=15)
            if p.returncode:raise RuntimeError('CAPTURE_INVALID')
            info=subprocess.run([self.ffprobe,'-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',str(path)],capture_output=True,check=True,timeout=10)
            return str(path),json.loads(info.stdout)
        except Exception:
            p.kill();p.wait();path.unlink(missing_ok=True);raise
    def cancel(self):
        if self.running:
            path,p=self.running;self.running=None
            p.kill();p.wait(timeout=10);path.unlink(missing_ok=True)
