# v1 vs v2 evaluation results (October 17, 2026)

Every run below is a real Nicrron call through `/api/strategies/generate` and a PRISM trace, graded by
[`scripts/eval_run.py`](../../scripts/eval_run.py) against the `expect` block of each input. v1 is the original prompt
without retrieval; v2 adds the Knowledge Base context, the unit table and "never invent a value; ask". Both versions
ran on the same inputs:

- [`inputs.jsonl`](inputs.jsonl): 63 inputs (clear rules, unit traps, fractions, unsupported asks, risk loosening,
  typos, vague text).
- [`inputs_hard.jsonl`](inputs_hard.jsonl): 38 harder inputs written after the first run (later cutoffs, restated
  fixed rules, compound units, ranges, implied times, late quantities, unsupported limits, invented values). The
  result files call it `inputs_hard.draft.jsonl`, its name while it was under review.

## Scores

| Model (via Nicrron) | Inputs | v1 pass | v2 pass |
|---|---|---|---|
| `nicrron/auto` (routed to `anthropic/claude-opus-5-5`) | 63 original | 61 | 63 |
| `nicrron/auto` (routed to `anthropic/claude-opus-5-5`) | 38 harder | 37 | 35 |
| `openai/gpt-4o-mini` | 63 original | 37 | 36 |
| `openai/gpt-4o-mini` | 38 harder | 22 | 21 |
| `openai/gpt-4.1-mini` | 63 original | 45 | 48 |

On `openai/gpt-4o-mini`, the same model for both versions, across all 101 inputs:

| | v1 | v2 |
|---|---|---|
| Pass | 59 | 57 |
| Runs that set a value the trader never stated (`invented:` / `forbidden:`) | 11 | 2 |
| Unit errors (points, cents or bare numbers copied into a tick field) | 4 | 0 |
| Unit-trap inputs passed | 13 / 20 | 16 / 20 |
| Unnecessary questions (`over_asked`) | 15 | 23 |

v2 removes the dangerous failure, a wrong value in an approvable draft, and asks more often instead. An extra
question blocks approval; it does not apply a value.

On Opus 5.5 both versions rarely fail. Its remaining failures are later-cutoff requests ("Keep trading until 17:00",
`cut-03` to `cut-05`) where the model asks instead of applying the value and letting the server flag `RISK_LOOSENED`.

## Failure cluster

v1 on `openai/gpt-4o-mini`, 4 runs, one cause: a non-tick unit copied into a tick field.

| Input | Trader text | v1 set |
|---|---|---|
| `unit-05` | Pullback tolerance 2 points from the moving average. | `entry.tolerance_ticks = 2` |
| `mix-01` | Stop 6 ticks under the swing low and let the pullback dip 2 points under the SMA. | `entry.tolerance_ticks = 2` |
| `unit-06` | Stop 5 below the low, target 1.5R. | `stop.buffer_ticks = 5` |
| `unit-10` | Give it 2 cents of room under the swing low and take profit at 1.5 times risk. | `stop.buffer_ticks = 20` |

v2 set none of these values. PRISM sessions: `eval-v1-mini-full-<id>` and `eval-v1-mini-hard-<id>`.

The same cause shows up on `openai/gpt-4.1-mini`: v1 set `unit-05` (2 points → 2 ticks), `unit-06` (bare 5 → 5
ticks), `unit-07` (15 ticks → `exit.target_r = 1.25`) and `unit-10` (2 cents → 20 ticks); v2 set none of them.

## PRISM Root Cause

PRISM's per-trace analysis ran on the 42 failed v1 `openai/gpt-4o-mini` traces, then Root Cause "Analyze now" built
two active clusters, both marked Tentative with the evidence "judge majority only … no hard evidence":

| Cluster | Affected |
|---|---|
| failures in tradeagent-strategy-translator on path request_init>llm_call>final_answer (Path Conformance) | 78 |
| prompt failures on path request_init>llm_call>final_answer (e.g. 'strategy customization exit scaling') | 13 |

PRISM's clusters are broader than the harness's unit-error cluster above and do not isolate it. Root Cause could not
locate the prompt in code ("prompts not detected in connected repo"): the PRISM project was connected to the
planning repo `antunishdPursuit/money-talks-2`, not this one.

## PRISM evaluator: v1 vs v2 on `openai/gpt-4.1-mini`

The Evaluators Hub can narrow a run only by model, and the `openai/gpt-4o-mini` traces include the pre-fix `v2-mini`
batches. So the 63 original inputs were run again for v1 and v2 on `openai/gpt-4.1-mini`, a model used nowhere else
in the project, with the span fix in place, and the evaluator scored every `openai/gpt-4.1-mini` trace: 126, plus
one v1 `clear-01` trace from a smoke test (`results/v1-m41-smoke.json`, labelled faithful).

The evaluator is "Translation faithfulness": the rubric in [`docs/kb/EVALUATOR.md`](../../docs/kb/EVALUATOR.md), with
its last line mapped to PRISM's label rails: faithful (score 1.0), partial (between 0 and 1), unfaithful (score 0).
It ran on PRISM's included engine. Export: `results/prism-eval-m41.json`.

| `openai/gpt-4.1-mini`, 63 inputs | v1 | v2 |
|---|---|---|
| PRISM average score | 80.7 | 79.3 |
| PRISM faithful / partial / unfaithful | 40 / 16 / 7 | 30 / 29 / 4 |
| Harness pass | 45 | 48 |
| Runs that set a value the trader never stated | 11 | 1 |
| Unit errors | 4 | 0 |
| Unit-trap inputs passed | 7 / 11 | 10 / 11 |
| Unnecessary questions (`over_asked`) | 2 | 8 |

PRISM's judge scores v1 and v2 about the same, while the harness shows v2 removing almost every value the trader never
stated. The judge does not apply parts of the rubric:

- Of v1's 11 runs that set a value the trader never stated, it labelled 5 faithful (score 100): `unit-06` (bare 5 →
  5 ticks), `unit-10` (2 cents → 20 ticks, with reasoning that calls the conversion correct), `vague-01` ("tight
  stop" → 2 ticks), `vague-02` ("a bit more room" → 6 ticks) and `risk-06` (max trades set to 20 for "trade as much
  as I want"). It gave `unit-05` and `vague-04` partial, and only 4 unfaithful.
- It marks down correct clarification questions: 25 v2 runs that pass the harness are partial or unfaithful, many
  for asking about an ambiguous unit the rubric says must be asked about (`unit-01`, `unit-05`, `unit-10`).
- It also scored v1 `unit-01` unfaithful (0) after reading "4 points" as a defined unit, the opposite of the rubric.

The harness grades against fixed expectations per input; the PRISM judge is an LLM applying the rubric text. Where
they disagree on unit errors, the harness follows the rubric.

## Files

| File | Prompt | Model | Inputs | PRISM sessions |
|---|---|---|---|---|
| `results/v1-full.json`, `results/v2-full.json` | v1 / v2 | Opus 5.5 | original | `eval-v1-full-*`, `eval-v2-full-*` |
| `results/v1-hard.json`, `results/v2-hard.json` | v1 / v2 | Opus 5.5 | harder | `eval-v1-hard-*`, `eval-v2-hard-*` |
| `results/v1-mini-full.json`, `results/v1-mini-hard.json` | v1 | gpt-4o-mini | both | `eval-v1-mini-full-*`, `eval-v1-mini-hard-*` |
| `results/v2-mini-full.json`, `results/v2-mini-hard.json` | v2 | gpt-4o-mini | both | `eval-v2-mini-full-*`, `eval-v2-mini-hard-*` |
| `results/v2-mini2-full.json`, `results/v2-mini2-hard.json` | v2 | gpt-4o-mini | both | `eval-v2-mini2-full-*`, `eval-v2-mini2-hard-*` |
| `results/v2-mini2-retry-full.json`, `results/v2-mini2-retry-hard.json` | v2 | gpt-4o-mini | 9 re-sends | `eval-v2-mini2-retry-*` |
| `results/v1-m41.json`, `results/v2-m41.json` | v1 / v2 | gpt-4.1-mini | original | `eval-v1-m41-*`, `eval-v2-m41-*` |
| `results/v1-m41-smoke.json` | v1 | gpt-4.1-mini | `clear-01` | `eval-v1-m41-smoke-clear-01` |
| `results/prism-eval-m41.json` | PRISM evaluator labels, scores and reasoning for the 127 traces above | | | |

The `v2-mini` traces were sent before the span fix in `backend/prism_client.py` (PR #12), so PRISM shows their
retrieved context as the output. The `v2-mini2` batches repeat the same inputs on that fix and carry the model's
reply as the output; their grades match `v2-mini` (temperature 0). The `retry` files re-send the 9 inputs whose
trace or Knowledge Base search timed out in the parallel `v2-mini2` run, so every input has a correct v2 trace.

Pass counts come from this harness. PRISM evaluator scores exist only for the `openai/gpt-4.1-mini` batches (see
above).

## Reproduce

```bash
.venv/bin/python scripts/eval_run.py --prompt-version v1 --tag full
.venv/bin/python scripts/eval_run.py --prompt-version v2 --tag full
NICRRON_MODEL=openai/gpt-4o-mini .venv/bin/python scripts/eval_run.py --prompt-version v1 --tag mini-hard --inputs tests/eval/inputs_hard.jsonl
.venv/bin/python scripts/eval_run.py --compare tests/eval/results/v1-mini-full.json tests/eval/results/v2-mini2-full.json
NICRRON_MODEL=openai/gpt-4.1-mini .venv/bin/python scripts/eval_run.py --prompt-version v2 --tag m41
```
