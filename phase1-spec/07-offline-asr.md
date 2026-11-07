Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Offline ASR and acceptance policy

Proposed Phase 1 recognizer: explicitly configured bundled Vosk English model with fixed digit-word grammar and unknown/silence handling. Exact model/runtime build and hashes await provisioning qualification. This is a proposal for review, not an installed or measured choice. whisper.cpp may be evaluated as a separate local configuration, not automatic fallback. Google/network STT is prohibited under every failure condition.

## Proposed deterministic policy
1. Decode the entire captured speech interval once with fixed settings, without receiving the expected challenge as a prompt, grammar specialization or scoring hint.
2. Require a completed final result. Partial transcripts never pass. Normalize only case and whitespace, and map explicit zero..nine tokens (or explicit single ASCII digits) to their digits. No homophone expansion, edit-distance tolerance, filler deletion, substring matching or digits-only salvage. Leading zeros survive.
3. Require exactly five valid digit tokens and no unknown/non-digit tokens. No speech, four/six tokens, repeated utterance of the code, filler words or invalid token output => FAIL.
4. Evaluate the decoder's top-ranked final candidate only. If multiple final alternatives are returned and normalize to distinct valid five-digit strings, reject as ASR_AMBIGUOUS, even if one equals expected. Equivalent formatting duplicates may collapse. A correct lower-ranked alternative can never rescue an incorrect top result. An invalid top candidate is rejected, not skipped.
5. Compare the resulting string exactly with the memory-only expected digits; no other value is accepted. Recognizer failure/missing model => ERROR and visible local diagnostic, never another engine.

No numerical confidence cutoff is invented here. Log confidence only in consented development evidence if the backend supplies it; absence of alternate hypotheses does not prove unambiguous speech. This conservative lexical policy still requires acoustic validation; grammar can force noise into digits. A future confidence gate is a separately versioned development change with freeze discipline, not silent tuning of identity thresholds.

## Tests and evidence
Use >=10 speakers x20 random codes with varied noise, keeping development separate from later held-out attacks. Include leading zeros, repetitions, wrong first/middle/last digit, transposition, four/six digits, silence/noise, homophones, filler phrases, multiple readings and a correct lower-ranked candidate. Stub decoder results test policy independently of acoustic recognition. Acoustic tests report string-exact accuracy and false matches against issued/wrong codes, not just character accuracy. Verify expected value never enters decoder inputs. Missing/corrupt model, unknown engine, missing native DLL and decoder exception must visibly fail with zero attempted networking.

Current-checkout any-candidate acceptance, word aliases and digit reductions are NOT this policy; submitted behavior confirmed in pinned HEAD (speechToTexty.py, speechToTextLocal.py and captchaStore.js). Report ASR-policy effects separately from matcher parity. An unintelligible utterance becoming a matching transcript is a measured limitation, not ruled out by a grammar.
