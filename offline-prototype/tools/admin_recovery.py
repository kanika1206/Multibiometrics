"""Windows administrator-only DELETE + RE-ENROLL recovery; no bypass grant.
Closes the key-loss dead end by destroying old content, template and wrapped keys.
Never touches v1. Requires no running verifier and explicit identity confirmation.
"""
import os,sys,sqlite3,ctypes
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from core.security import deny_network,WindowsStateLock
from core.paths import windows_state_root
def main():
    deny_network()
    if os.name!='nt' or not ctypes.windll.shell32.IsUserAnAdmin():raise SystemExit('Windows administrator required')
    identity=input('Local identity to DELETE and re-enroll: ')
    if not identity or input('Type the same identity again to erase its protected content: ')!=identity:raise SystemExit('Cancelled')
    root=windows_state_root();state=root/'vault'
    if not all((state/name).is_file() for name in ['vault.db','content.db','attempts.db']):raise SystemExit('State missing; nothing changed')
    lock=WindowsStateLock(root);db=sqlite3.connect(state/'vault.db',isolation_level=None)
    try:
        db.execute('ATTACH DATABASE ? AS contentdb',(str(state/'content.db'),));db.execute('ATTACH DATABASE ? AS attemptdb',(str(state/'attempts.db'),))
        for schema in ['main','contentdb','attemptdb']:
            db.execute(f'PRAGMA {schema}.journal_mode=DELETE');db.execute(f'PRAGMA {schema}.secure_delete=ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            db.execute('DELETE FROM vault WHERE identity=?',(identity,));db.execute('DELETE FROM contentdb.content WHERE identity=?',(identity,));db.execute("UPDATE attemptdb.attempts SET status='INVALIDATED' WHERE identity=?",(identity,));db.execute('COMMIT')
        except Exception:db.execute('ROLLBACK');raise
        print('Deleted. Fresh three-sample enrollment and confirmation required. No session granted.')
    finally:db.close();lock.close()
if __name__=='__main__':main()
