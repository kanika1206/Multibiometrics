"""On-premises speech-to-text for the challenge factor.

Why this exists
---------------
speechToTexty.py sends the login audio to a third-party cloud API. That
contradicts the privacy position the rest of the system takes: raw recordings
are destroyed after template extraction and templates are encrypted under
per-user keys, yet the audio -- which carries both the spoken challenge and the
user's voice -- was leaving the deployment in the clear. This module runs the
transcription locally so the recording never leaves the server.

It is a drop-in backend for speechToTexty.py and keeps that script's contract
exactly:

  stdout  one "Captcha: <transcript>" line per candidate reading
  exit 0  at least one candidate was produced
  exit 2  nothing usable

Why several candidates
----------------------
The challenge is a five-symbol digit string. A general-purpose recogniser is
trained on natural language, so a spoken "six five one" is frequently returned
as a word that sounds like it rather than as digits. The caller accepts the
factor if ANY candidate matches after captchaStore.normalizeCaptcha, so the
useful thing to emit is a small set of readings rather than one best guess:

  1. the unbiased transcript, which is what the recogniser thinks was said;
  2. a digit-biased transcript, decoded with a prompt that tells the model to
     expect a digit string -- this recovers the common "sexy" for "six five"
     class of error;
  3. a digits-only reduction of each, which lets a transcript carrying stray
     filler words ("okay, nine four two") still match.

Candidates are de-duplicated. Emitting several does not weaken the factor: the
caller still requires an exact match against the single-use server-side code
after normalization, so a candidate that is not the issued code cannot pass.

Model
-----
faster-whisper (CTranslate2). WHISPER_MODEL selects the checkpoint, default
"small.en"; WHISPER_DEVICE and WHISPER_COMPUTE_TYPE override placement. The
checkpoint is fetched once on first use and cached under WHISPER_CACHE (default
models/whisper next to this file), after which the path is fully offline.

Usage:  speechToTextLocal.py <audio file>
"""
import os
import re
import sys

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small.en")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
CACHE_DIR = os.environ.get(
    "WHISPER_CACHE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "whisper"),
)

# Telling the model to expect a digit string is what separates this from a
# generic transcription: without it, five spoken digits are routinely decoded as
# ordinary words.
DIGIT_PROMPT = "The speaker reads a five digit numeric code, one digit at a time."

_model = None


def get_model():
    """Load once per process. Module-level so a warm worker can reuse it."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE, download_root=CACHE_DIR
        )
    return _model


def _transcribe(model, path, prompt):
    segments, _ = model.transcribe(
        path,
        language="en",
        beam_size=5,
        # The challenge is a single short utterance; carrying context between
        # segments only lets one misreading propagate into the next.
        condition_on_previous_text=False,
        initial_prompt=prompt,
        vad_filter=False,  # a five-digit code is short enough that VAD can eat it
    )
    return " ".join(s.text.strip() for s in segments).strip()


def _digits_only(text):
    """The digit subsequence of a transcript, or "" when it carries none."""
    return "".join(re.findall(r"\d", text))


def candidates(path):
    """Ordered, de-duplicated readings of the audio at `path`."""
    model = get_model()
    out = []

    def add(text):
        text = (text or "").strip()
        if text and text not in out:
            out.append(text)

    unbiased = _transcribe(model, path, None)
    add(unbiased)
    biased = _transcribe(model, path, DIGIT_PROMPT)
    add(biased)
    # Reductions come last: they are the most permissive readings, and the
    # caller's match is exact after normalization, so ordering only affects
    # which candidate is logged first, never whether a wrong code is accepted.
    for text in (biased, unbiased):
        add(_digits_only(text))
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: speechToTextLocal.py <audio file>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    if not os.path.exists(path):
        print("error: no such audio file: %s" % path, file=sys.stderr)
        return 2

    try:
        readings = candidates(path)
    except ImportError:
        # Distinguished from a transcription failure: the operator has a package
        # to install, not a recording to re-record.
        print(
            "error: faster-whisper is not installed. Install it (pip install faster-whisper) "
            "or set STT_ENGINE=google to fall back to the third-party API.",
            file=sys.stderr,
        )
        return 2
    except Exception as e:
        print("error: %s" % e, file=sys.stderr)
        return 2

    if not readings:
        print("error: speech unintelligible", file=sys.stderr)
        return 2

    for text in readings:
        print("Captcha: " + text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
