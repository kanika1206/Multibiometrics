"""Encrypted identity content, same-user DPAPI wrapped independent AES key."""
import secrets,sqlite3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .vault import canonical
class Content:
    def __init__(self,path,protector):
        self.protector=protector
        self.db=sqlite3.connect(path,isolation_level=None)
        self.db.execute('PRAGMA secure_delete=ON');self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS content(identity TEXT PRIMARY KEY, wrapped BLOB, nonce BLOB, ciphertext BLOB)')
    def save(self,identity,text):
        if not isinstance(text,str) or len(text.encode())>32768:raise ValueError('CONTENT_TOO_LARGE')
        key=secrets.token_bytes(32);nonce=secrets.token_bytes(12)
        aad=canonical({'identity':identity,'kind':'protected-content','schema':1})
        ct=AESGCM(key).encrypt(nonce,text.encode(),aad)
        self.db.execute('INSERT OR REPLACE INTO content VALUES(?,?,?,?)',(identity,self.protector.wrap(key),nonce,ct))
    def load(self,identity):
        row=self.db.execute('SELECT wrapped,nonce,ciphertext FROM content WHERE identity=?',(identity,)).fetchone()
        if not row:return ''
        try:key=self.protector.unwrap(row[0])
        except Exception as e:raise ValueError('KEY_UNAVAILABLE') from e
        try:return AESGCM(key).decrypt(row[1],row[2],canonical({'identity':identity,'kind':'protected-content','schema':1})).decode()
        except Exception as e:raise ValueError('TEMPLATE_INVALID') from e
    def delete(self,identity):self.db.execute('DELETE FROM content WHERE identity=?',(identity,))
    def close(self):self.db.close()
