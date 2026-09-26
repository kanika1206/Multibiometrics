"""Transcribe the login audio for the challenge factor.

Exit code is the authoritative signal: 0 = transcript(s) produced, 2 = error.
stdout carries one "Captcha: <transcript>" line per alternative reading: the top
guess for a spoken digit string is often a sound-alike word ("sexy" for "six
five..."), while the correct reading sits in a lower-ranked alternative. The
caller accepts the factor if ANY candidate matches the issued CAPTCHA after
normalization, so several candidates are emitted and the match itself stays
exact.

Two engines, selected by STT_ENGINE:

  local   (default) speechToTextLocal.py, faster-whisper on this machine.
  google            the third-party cloud recogniser.

Local is the default because the rest of the system destroys raw recordings and
encrypts templates under per-user keys, and uploading the login audio to an
external service would undo that for the one artefact carrying both the spoken
challenge and the user's voice. The cloud engine remains available for
deployments that cannot host a model, but it is a privacy regression and says so
in the log.

If STT_ENGINE is unset and faster-whisper is not installed, this falls back to
the cloud engine rather than failing a login, and warns. Set STT_ENGINE
explicitly in production so the transport is a decision, not an accident.
"""
import os
import sys

DEFAULT_ENGINE = "local"


def run_local(path):
    import speechToTextLocal

    return speechToTextLocal.candidates(path)


def run_google(path):
    """The original cloud path: convert to wav, post the audio, take every
    alternative the API returns."""
    import tempfile

    import speech_recognition as sr
    from pydub import AudioSegment

    # The library defaults to a plain-HTTP endpoint; this network (and any sane
    # deployment) requires TLS. Same API, encrypted transport. The default is
    # bound at def time, so it must be passed per call, not patched module-level.
    endpoint = "https://www.google.com/speech-api/v2/recognize"

    # Convert to wav in a private temp file. The old code wrote a shared
    # "transcript.wav" in the working directory, so two concurrent logins would
    # transcribe each other's audio.
    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        AudioSegment.from_file(path).export(wav_path, format="wav")
        r = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)
        result = r.recognize_google(audio, endpoint=endpoint, show_all=True)
    finally:
        os.unlink(wav_path)

    # show_all=True returns {} or [] when nothing was recognized, otherwise
    # {"alternative": [{"transcript": ...}, ...], ...}.
    alternatives = result.get("alternative", []) if isinstance(result, dict) else []
    return [a["transcript"] for a in alternatives if a.get("transcript")]


def resolve_engine():
    """The engine to use, and whether it was chosen or fallen back to."""
    requested = os.environ.get("STT_ENGINE", "").strip().lower()
    if requested in ("local", "google"):
        return requested, False
    try:
        import faster_whisper  # noqa: F401  -- probing availability only
    except ImportError:
        return "google", True
    return DEFAULT_ENGINE, False


def main():
    if len(sys.argv) < 2:
        print("usage: speechToTexty.py <audio file>", file=sys.stderr)
        return 2
    path = sys.argv[1]

    chosen, fell_back = resolve_engine()
    if fell_back:
        print(
            "warning: faster-whisper is not installed, falling back to the third-party "
            "cloud recogniser. The login audio will leave this machine. Install "
            "faster-whisper, or set STT_ENGINE=google to make this explicit.",
            file=sys.stderr,
        )

    try:
        transcripts = run_local(path) if chosen == "local" else run_google(path)
    except Exception as e:
        # An unintelligible recording and a transcription crash are both "no
        # usable speech" to the caller; the detail stays on stderr.
        print("error: %s" % (e or "speech unintelligible"), file=sys.stderr)
        return 2

    if not transcripts:
        print("error: speech unintelligible", file=sys.stderr)
        return 2

    print("stt engine: %s" % chosen, file=sys.stderr)
    for t in transcripts:
        print("Captcha: " + t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
