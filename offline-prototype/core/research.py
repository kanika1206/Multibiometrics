"""Explicit plaintext-retention exception; per-recording consent, never automatic."""
from pathlib import Path
import secrets,shutil
class ResearchCapture:
    def __init__(self,directory,enabled=False):self.directory=Path(directory);self.enabled=enabled
    def retain(self,source,consent):
        if not self.enabled or consent is not True:return None
        self.directory.mkdir(parents=True,exist_ok=True)
        target=self.directory/(secrets.token_hex(16)+Path(source).suffix)
        shutil.copyfile(source,target)
        return target.name
