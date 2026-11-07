import json,secrets,sqlite3,threading
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
class Vault:
    def __init__(self,path,protector,models):
        self.models=models;self.protector=protector;self.lock=threading.RLock()
        self.db=sqlite3.connect(path,check_same_thread=False,isolation_level=None)
        self.db.execute('PRAGMA secure_delete=ON');self.db.execute('PRAGMA journal_mode=DELETE');self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS vault(identity TEXT, generation TEXT PRIMARY KEY, active INTEGER, metadata BLOB, wrapped BLOB, nonce BLOB, ciphertext BLOB)')
        self.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS one_active ON vault(identity) WHERE active=1')
        self.db.execute('DELETE FROM vault WHERE active=0')
    def exists(self,identity):return self.db.execute('SELECT 1 FROM vault WHERE identity=? AND active=1',(identity,)).fetchone() is not None
    def stage(self,identity,template):
        generation=secrets.token_hex(16);key=secrets.token_bytes(32);nonce=secrets.token_bytes(12)
        meta=canonical({'identity':identity,'generation':generation,'schema':2,'models':self.models})
        wrapped=self.protector.wrap(key);cipher=AESGCM(key).encrypt(nonce,canonical(template),meta)
        with self.lock:self.db.execute('INSERT INTO vault VALUES(?,?,0,?,?,?,?)',(identity,generation,meta,wrapped,nonce,cipher))
        return generation
    def load(self,identity,generation=None):
        with self.lock:
            if generation:row=self.db.execute('SELECT generation,metadata,wrapped,nonce,ciphertext FROM vault WHERE identity=? AND generation=?',(identity,generation)).fetchone()
            else:row=self.db.execute('SELECT generation,metadata,wrapped,nonce,ciphertext FROM vault WHERE identity=? AND active=1',(identity,)).fetchone()
            if not row:raise ValueError('IDENTITY_UNKNOWN')
            gen,meta,wrapped,nonce,cipher=row
            if meta!=canonical({'identity':identity,'generation':gen,'schema':2,'models':self.models}):raise ValueError('TEMPLATE_INVALID')
            try:key=self.protector.unwrap(wrapped)
            except Exception as e:raise ValueError('KEY_UNAVAILABLE: REENROLLMENT_REQUIRED') from e
            try:return json.loads(AESGCM(key).decrypt(nonce,cipher,meta))
            except Exception as e:raise ValueError('TEMPLATE_INVALID') from e
    def activate(self,identity,generation,replace=False):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                self.load(identity,generation)
                if self.exists(identity) and not replace:raise ValueError('IDENTITY_EXISTS')
                self.db.execute('DELETE FROM vault WHERE identity=? AND generation!=?',(identity,generation))
                if self.db.execute('UPDATE vault SET active=1 WHERE identity=? AND generation=?',(identity,generation)).rowcount!=1:raise ValueError('TEMPLATE_INVALID')
                self.db.execute('COMMIT')
            except Exception:self.db.execute('ROLLBACK');raise
    def delete(self,identity):
        with self.lock:self.db.execute('DELETE FROM vault WHERE identity=?',(identity,))
    def discard(self,generation):self.db.execute('DELETE FROM vault WHERE generation=? AND active=0',(generation,))
    def close(self):self.db.close()
