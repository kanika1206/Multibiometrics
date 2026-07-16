import os
import sys
import tempfile

import speech_recognition as sr
from pydub import AudioSegment

# The library defaults to a plain-HTTP endpoint; this network (and any sane
# deployment) requires TLS. Same API, encrypted transport. The default is
# bound at def time, so it must be passed per call, not patched module-level.
ENDPOINT = "https://www.google.com/speech-api/v2/recognize"

# Exit code is the authoritative signal: 0 = transcript(s) produced, 2 = error.
# stdout carries one "Captcha: <transcript>" line per STT alternative: the API's
# top guess for a spoken digit string is often a sound-alike word ("sexy" for
# "six five..."), while the correct reading sits in a lower-ranked alternative.
# The caller accepts the factor if ANY candidate matches the issued CAPTCHA.

try:
    file = sys.argv[1]

    # Convert mp3 to wav in a private temp file. The old code wrote a shared
    # "transcript.wav" in the working directory, so two concurrent logins
    # would transcribe each other's audio.
    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        AudioSegment.from_mp3(file).export(wav_path, format="wav")
        r = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)
        result = r.recognize_google(audio, endpoint=ENDPOINT, show_all=True)
    finally:
        os.unlink(wav_path)
except sr.UnknownValueError:
    print("error: speech unintelligible", file=sys.stderr)
    sys.exit(2)
except Exception as e:
    print(f"error: {e}", file=sys.stderr)
    sys.exit(2)

# show_all=True returns {} or [] when nothing was recognized, otherwise
# {"alternative": [{"transcript": ...}, ...], ...}.
alternatives = result.get("alternative", []) if isinstance(result, dict) else []
transcripts = [a["transcript"] for a in alternatives if a.get("transcript")]
if not transcripts:
    print("error: speech unintelligible", file=sys.stderr)
    sys.exit(2)

for t in transcripts:
    print("Captcha: " + t)
sys.exit(0)
