"""Local-only development export with synthetic parity; never a qualification claim.
All paths are inside offline-prototype. No participant data is used.
"""
import os,sys,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from core.security import deny_network
deny_network()
import torch
import torch.nn.functional as F
from speechbrain.lobes.features import Fbank
from speechbrain.processing.features import InputNormalization
from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN
torch.set_num_threads(4);torch.manual_seed(20261102)
class Model(torch.nn.Module):
    def __init__(self,export=False):
        super().__init__();self.export=export
        self.features=Fbank(n_mels=80)
        self.normalizer=InputNormalization(norm_type='sentence',std_norm=False)
        self.encoder=ECAPA_TDNN(input_size=80,channels=[1024,1024,1024,1024,3072],kernel_sizes=[5,3,3,3,1],dilations=[1,2,3,4,1],attention_channels=128,lin_neurons=192)
        state=torch.load(ROOT/'assets/ecapa-source/embedding_model.ckpt',map_location='cpu',weights_only=True)
        self.encoder.load_state_dict(state)
        # Equivalent real DFT formulation avoids complex STFT ONNX export limitation.
        n=torch.arange(400,dtype=torch.float64);k=torch.arange(201,dtype=torch.float64)[:,None]
        phase=2*torch.pi*k*n/400;window=torch.hamming_window(400,dtype=torch.float64)
        self.register_buffer('real',(torch.cos(phase)*window).float()[:,None,:])
        self.register_buffer('imag',(-torch.sin(phase)*window).float()[:,None,:])
    def forward(self,wave):
        if self.export:
            x=F.pad(wave[:,None,:],(200,200),'constant',0)
            r=F.conv1d(x,self.real,stride=160);i=F.conv1d(x,self.imag,stride=160)
            feats=self.features.compute_fbanks((r*r+i*i).transpose(1,2))
            feats=feats-feats.mean(dim=1,keepdim=True)
        else:feats=self.normalizer(self.features(wave),torch.ones(wave.shape[0]))
        return self.encoder(feats).reshape(wave.shape[0],192)
def main():
    reference=Model().eval();export=Model(True).eval()
    rows=[];waves=[torch.randn(1,n)*.05 for n in [16000,32000,48000]]
    with torch.no_grad():
        for wave in waves:
            a=reference(wave);b=export(wave);cos=float(F.cosine_similarity(a,b).item())
            rows.append({'samples':wave.shape[1],'pytorch_vs_real_dft_cosine':cos})
            if cos<=.99:raise RuntimeError('PARITY_FAILED before ONNX export')
    output=ROOT/'assets/ecapa-waveform.onnx'
    torch.onnx.export(export,waves[1],str(output),input_names=['waveform'],output_names=['embedding'],dynamic_axes={'waveform':{1:'samples'}},opset_version=17,dynamo=False)
    import onnxruntime as ort
    ort.disable_telemetry_events();session=ort.InferenceSession(str(output),providers=['CPUExecutionProvider'])
    with torch.no_grad():
        for row,wave in zip(rows,waves):
            a=reference(wave);b=torch.from_numpy(session.run(None,{'waveform':wave.numpy()})[0]);row['source_vs_onnx_cosine']=float(F.cosine_similarity(a,b).item())
            if row['source_vs_onnx_cosine']<=.99:raise RuntimeError('PARITY_FAILED ONNX')
    report={'status':'SYNTHETIC_PARITY_ONLY_NOT_QUALIFIED','source_checkpoint_sha256':hashlib.sha256((ROOT/'assets/ecapa-source/embedding_model.ckpt').read_bytes()).hexdigest(),'export_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'rows':rows,'limitations':'Synthetic random waveforms only. No genuine/impostor recordings, no near-threshold real-media parity, no Windows target result.'}
    (ROOT/'evidence/ecapa-export-parity.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))

if __name__=='__main__':main()
