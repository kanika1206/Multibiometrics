# Attack evaluation protocol

How to produce the attack success rates the paper reports. The harness is
`backend/scripts/attack_suite.mjs`; the adversary definitions it implements are
in [THREAT_MODEL.md](THREAT_MODEL.md).

Every attack is scored through the **deployed** code paths — the same template
extractor, the same two matchers at `tau_f = 0.35` and `tau_a = 0.30`, the same
speech-to-text engine and normalization, and the conjunctive rule in
`backend/decisionRule.js` that the login controller itself calls. An attack
success rate produced here is a statement about the system as shipped.

## 1. What you need

A small corpus in which **the spoken content is known**. The challenge factor
cannot be scored against a recording when nobody knows what was said in it, so
the public-dataset corpus used for recognition accuracy is not usable here: its
speakers read dataset sentences, not challenge codes.

```
<attack_corpus>/<subject>_s<session>__<code>.mp4
```

for example

```
p01_s1__93417.mp4     p02_s1__20458.mp4
p01_s2__61802.mp4     p02_s2__77135.mp4
```

Requirements:

- **at least two subjects**, so an impostor is a different person;
- **at least two sessions each**, so the enrolled reference and the attack
  medium are never the same recording;
- each recording shows one face and carries the speaker reading the five-digit
  code in its filename.

Session 1 is enrolled (through the enrolment quality gate, exactly as
registration would); session 2 onwards supplies attack material.

Ten subjects x two sessions is enough to report the replay, splice and photo
rows with meaningful denominators. This is a consented collection of your own
participants — the attack corpus is the one place a public dataset cannot
substitute.

## 2. The three built-in attacks

```bash
cd backend
node scripts/attack_suite.mjs --corpus ../attack_corpus --out ../attack_out
```

runs `replay`, `splice` and `photo`, which need no external tooling — the
harness synthesises the attack media with ffmpeg.

| Row | What is submitted | Challenge the server issues |
|---|---|---|
| `replay` | the victim's archived session-2 recording, unmodified | a fresh code, different from the one in the recording |
| `splice_victim_face` | victim's video muxed with the attacker's audio | the code the attacker speaks — a live adversary reading the challenge off the screen |
| `splice_victim_voice` | attacker's video muxed with the victim's archived audio | the code in the victim's archived clip |
| `photo_live_voice` | a single still frame of the victim, looped, with the attacker's audio | the code the attacker speaks |
| `photo_archived_audio` | a single still frame of the victim with the victim's own archived audio | a fresh code |

Note what the last column encodes: it is the threat model in operational form.
An adversary holding only archived media faces a code it has never heard; an
adversary who can speak answers the code it was just shown. Both are reported,
because they fail for different reasons.

## 3. Voice cloning

Use **one** off-the-shelf tool and name it in the paper. The harness does not
bundle or invoke a cloning tool: which tool produced the attack is part of the
result, and burying it inside the harness would make the number unattributable.

1. Take a reference sample of each victim — session 1 is the natural choice,
   since that is what an adversary who found one public recording would have.
2. Synthesise the victim's voice reading a five-digit code.
3. Save the audio as `<subject>__<code>.wav`, e.g. `p01__58124.wav`.
4. Run:

```bash
node scripts/attack_suite.mjs --corpus ../attack_corpus --out ../attack_out \
     --attacks clone --clones ../clone_audio
```

The harness muxes the cloned audio onto the victim's own video, so the face and
challenge factors both pass and the measurement isolates the **speaker factor**:
`voice_asr` is the fraction of clones the deployed speaker matcher accepted, and
`system_asr` the fraction that would have been granted access.

**Report whatever comes out.** A high cloning success rate is a finding, not a
failure of the work: it is the strongest available evidence for the paper's own
argument that a synthetic-speech detector belongs in the pipeline, and a reader
who suspects the number was suppressed will discount everything else.

## 4. Face swap

Same shape, with video:

1. Produce a swapped video putting the victim's face on another person's
   recording — or on your own — with the speaker reading a five-digit code.
2. Save as `<subject>__<code>.mp4`.
3. Run:

```bash
node scripts/attack_suite.mjs --corpus ../attack_corpus --out ../attack_out \
     --attacks faceswap --swaps ../swap_video
```

Here the spoken answer is genuine and live, so the challenge factor passes and
the measurement isolates the **face factor**.

## 5. Reading the results

```
attack                       n     face    voice    chall   system
------------------------------------------------------------------
replay                      10   100.0%   100.0%     0.0%     0.0%
splice_victim_face          10   100.0%     0.0%   100.0%     0.0%
photo_live_voice            10    90.0%     0.0%   100.0%     0.0%
```

(Illustrative layout, not measured values.) Four numbers per attack, because the
system number alone hides the mechanism:

- **face / voice / challenge ASR** — how often each factor accepted the attack
  medium on its own;
- **system ASR** — how often all three accepted, i.e. access was granted.

A high face ASR beside a system ASR of zero is the result worth writing up: the
face factor was defeated and the system survived on the other two. That is the
conjunctive rule earning its place, and it argues the design's case better than
"no attack succeeded" does.

### The control

Every run includes `control_genuine`: the victim's own recording against the
challenge it actually speaks. It **must** be granted. A harness that rejects
everything reports zero attack success whether or not it works, so if the
control fails the run prints a warning, sets `control_valid: false` in
`attacks.json`, and exits non-zero. Do not report attack numbers from a run
whose control failed.

### The one number that is argued, not sampled

`analytic_replay_bound` in `attacks.json`. A replayed recording satisfies the
challenge only if its archived code happens to equal the freshly issued one,
with probability 1/100,000. Observing that empirically would take on the order
of 10^5 trials to see a single event, so it is derived from the challenge space
instead (THREAT_MODEL.md, Section 3) and labelled analytic in the paper.

## 6. Outputs

| File | Contents |
|---|---|
| `attack_out/attacks.json` | every attempt, its three verdicts, the fused decision, per-attack rates, the control verdict, and the analytic replay bound |
| `attack_out/attacks.tex` | `\AttackRows`, `\AttackChallengeSpace`, `\AttackSubjects` — `\input` these so the paper never retypes a rate |
| `attack_out/media/` | the synthesised attack media, with `--keep-media` |

`--keep-media` is worth using once: looking at a spliced or photo-replay file is
the quickest way to confirm the harness built the attack you think it built.
