"""Shared UI for both fixed entry points; no command-line policy switches."""
import threading,queue,time
import tkinter as tk
from core.security import install_power_hook
def run_shell(client,title,on_exit=None):
    root=tk.Tk();root.title(title)
    tk.Label(root,text=title).pack()
    events=queue.Queue();busy=False;epoch=0
    identity=tk.StringVar();camera=tk.StringVar();mic=tk.StringVar();consent=tk.BooleanVar(value=False);status=tk.StringVar(value='Locked');digits=tk.StringVar()
    for title,var in [('Identity',identity),('Camera (DirectShow name)',camera),('Microphone (DirectShow name)',mic)]:
        tk.Label(root,text=title).pack();tk.Entry(root,textvariable=var,width=48).pack()
    tk.Checkbutton(root,text='Consent to retain THIS recording as plaintext research data locally',variable=consent).pack()
    tk.Label(root,textvariable=digits,font=('Arial',24)).pack();tk.Label(root,textvariable=status,wraplength=500).pack()
    content=tk.Text(root,width=60,height=8,state='disabled');content.pack()
    buttons=[]
    def clear():
        digits.set('');content.configure(state='normal');content.delete('1.0','end');content.configure(state='disabled')
    def cancel():
        nonlocal epoch,busy
        epoch+=1;busy=False;clear();status.set('Locked / cancelled')
        threading.Thread(target=client.close,daemon=True).start()
    def request(op):
        nonlocal busy
        if busy:return
        busy=True;tag=epoch
        fields={'identity':identity.get()}
        if op=='start':fields.update(camera=camera.get(),microphone=mic.get(),consent=consent.get());consent.set(False);clear()
        if op=='save':fields['text']=content.get('1.0','end-1c')
        def run():
            try:
                response=client.call(op,**fields)
                if response.get('decision')=='ACCEPT':response['protected']=client.call('content')
                events.put((tag,response))
            except Exception as e:events.put((tag,{'status':str(e),'decision':'REJECT'}))
        threading.Thread(target=run,daemon=True).start()
    for label,op in [('Enroll / re-enroll','enroll'),('Start recording','start'),('Stop & check','stop'),('Save protected note','save'),('Delete identity','delete')]:
        b=tk.Button(root,text=label,command=lambda o=op:request(o));b.pack();buttons.append(b)
    tk.Button(root,text='Lock / cancel',command=cancel).pack()
    last=time.monotonic()
    def poll():
        nonlocal busy,last
        now=time.monotonic()
        # UI stall/suspend is conservatively invalidating. Worker challenge clock is independent.
        if now-last>2:cancel()
        last=now
        try:
            while True:
                tag,res=events.get_nowait()
                if tag!=epoch:continue
                busy=False;status.set(res.get('message',res.get('status','READY')))
                if 'digits' in res:digits.set(res['digits'])
                else:digits.set('')
                if 'protected' in res and res['protected'].get('identity')==identity.get():
                    content.configure(state='normal');content.delete('1.0','end');content.insert('1.0',res['protected'].get('content',''))
                elif res.get('decision')=='REJECT' or res.get('status') in ['DELETED','ENROLLMENT_STARTED']:clear()
        except queue.Empty:pass
        root.after(100,poll)
    def exit_app():
        client.close()
        if on_exit:on_exit(root)
        root.destroy()
    identity.trace_add('write',lambda *args:cancel())
    install_power_hook(root,cancel)
    root.protocol('WM_DELETE_WINDOW',exit_app);root.after(100,poll);root.mainloop()
