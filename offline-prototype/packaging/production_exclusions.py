"""Build/test-only wheel content excluded from the offline application payload."""
from pathlib import PurePosixPath
# Runtime ONNX remains: InsightFace's ArcFace implementation calls onnx.load.
EXCLUDED_PREFIXES=(
 'onnxruntime/tools/','onnxruntime/transformers/','onnxruntime/quantization/','onnxruntime/datasets/',
 'onnx/tools/','onnx/bin/','numpy/testing/','sympy/testing/','google/protobuf/testdata/',
 'insightface/gui/','insightface/commands/',
)
EXCLUDED_FILES={'cffi/setuptools_ext.py','cffi/recompiler.py','cffi/verifier.py','cffi/vengine_cpy.py','cffi/vengine_gen.py','sympy/utilities/pytest.py'}
EXCLUDED_PARTS={'tests','test','benchmarks','testdata','__pycache__'}
def excluded(relative):
 p=PurePosixPath(relative);name=p.name
 if relative in EXCLUDED_FILES:return True
 if relative.startswith("onnx/") and p.suffix in (".cc",".cpp",".h",".hpp"):return True
 if any(relative.startswith(prefix) for prefix in EXCLUDED_PREFIXES):return True
 if set(p.parts)&EXCLUDED_PARTS:return True
 if name=='conftest.py' or (name.endswith('.py') and (name.startswith(('test_','benchmark','bench_')) or name.endswith('_test.py'))):return True
 return False
