import secrets,sqlite3,time,threading

class Challenges:
    def __init__(self,path,clock=None):
        self.db=sqlite3.connect(path,check_same_thread=False,isolation_level=None)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, identity TEXT NOT NULL, status TEXT NOT NULL)')
        self.db.execute("UPDATE attempts SET status='INVALIDATED' WHERE status IN ('ISSUED','CONSUMED')")
        self.memory={};self.lock=threading.RLock();self.clock=clock or (lambda:(time.monotonic(),time.time()))
    def issue(self,identity):
        with self.lock:
            self.invalidate_identity(identity)
            aid=secrets.token_hex(16); digits=f'{secrets.randbelow(100000):05d}'
            self.db.execute('INSERT INTO attempts VALUES(?,?,?)',(aid,identity,'ISSUED'))
            self.memory[aid]=[identity,digits,self.clock(),self.clock()]
            return aid,digits
    def invalidate_identity(self,identity):
        with self.lock:
            self.db.execute("UPDATE attempts SET status='INVALIDATED' WHERE identity=? AND status IN ('ISSUED','CONSUMED')",(identity,))
            for aid in list(self.memory):
                if self.memory[aid][0]==identity:del self.memory[aid]
    def valid(self,aid):
        item=self.memory.get(aid)
        if not item:return False
        now=self.clock();start=item[2];last=item[3];item[3]=now
        # Conservative discontinuity check; suspend hook additionally invalidates all.
        return now[0]>=last[0] and now[1]>=last[1] and abs((now[0]-last[0])-(now[1]-last[1]))<1 and max(now[0]-start[0],now[1]-start[1])<300
    def consume(self,aid,identity):
        with self.lock:
            item=self.memory.get(aid)
            if not item or item[0]!=identity:raise ValueError('ATTEMPT_REPLAY')
            if not self.valid(aid):
                self.finish(aid,False);raise ValueError('CHALLENGE_EXPIRED_OR_CLOCK_ANOMALY')
            changed=self.db.execute("UPDATE attempts SET status='CONSUMED' WHERE id=? AND identity=? AND status='ISSUED'",(aid,identity)).rowcount
            if changed!=1:raise ValueError('ATTEMPT_REPLAY')
            return item[1]
    def finish(self,aid,passed):
        with self.lock:
            valid=self.valid(aid)
            row=self.db.execute('SELECT status FROM attempts WHERE id=?',(aid,)).fetchone()
            accept=bool(passed and valid and row and row[0]=='CONSUMED')
            self.db.execute("UPDATE attempts SET status=? WHERE id=? AND status IN ('ISSUED','CONSUMED')",('SUCCESS' if accept else 'FAILURE',aid))
            self.memory.pop(aid,None)
            return accept
    def suspend(self):
        with self.lock:
            self.db.execute("UPDATE attempts SET status='INVALIDATED' WHERE status IN ('ISSUED','CONSUMED')")
            self.memory.clear()
    def close(self):self.suspend();self.db.close()
