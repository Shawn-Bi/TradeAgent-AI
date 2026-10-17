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

## Files

| File | Prompt | Model | Inputs | PRISM sessions |
|---|---|---|---|---|
| `results/v1-full.json`, `results/v2-full.json` | v1 / v2 | Opus 5.5 | original | `eval-v1-full-*`, `eval-v2-full-*` |
| `results/v1-hard.json`, `results/v2-hard.json` | v1 / v2 | Opus 5.5 | harder | `eval-v1-hard-*`, `eval-v2-hard-*` |
| `results/v1-mini-full.json`, `results/v1-mini-hard.json` | v1 | gpt-4o-mini | both | `eval-v1-mini-full-*`, `eval-v1-mini-hard-*` |
| `results/v2-mini-full.json`, `results/v2-mini-hard.json` | v2 | gpt-4o-mini | both | `eval-v2-mini-full-*`, `eval-v2-mini-hard-*` |
| `results/v2-mini2-full.json`, `results/v2-mini2-hard.json` | v2 | gpt-4o-mini | both | `eval-v2-mini2-full-*`, `eval-v2-mini2-hard-*` |
| `results/v2-mini2-retry-full.json`, `results/v2-mini2-retry-hard.json` | v2 | gpt-4o-mini | 9 re-sends | `eval-v2-mini2-retry-*` |

The `v2-mini` traces were sent before the span fix in `backend/prism_client.py` (PR #12), so PRISM shows their
retrieved context as the output. The `v2-mini2` batches repeat the same inputs on that fix and carry the model's
reply as the output; their grades match `v2-mini` (temperature 0). The `retry` files re-send the 9 inputs whose
trace or Knowledge Base search timed out in the parallel `v2-mini2` run, so every input has a correct v2 trace.

The scores above come from this harness, not from the PRISM Evaluators Hub. The PRISM rubric is
[`docs/kb/EVALUATOR.md`](../../docs/kb/EVALUATOR.md).

## Reproduce

```bash
.venv/bin/python scripts/eval_run.py --prompt-version v1 --tag full
.venv/bin/python scripts/eval_run.py --prompt-version v2 --tag full
NICRRON_MODEL=openai/gpt-4o-mini .venv/bin/python scripts/eval_run.py --prompt-version v1 --tag mini-hard --inputs tests/eval/inputs_hard.jsonl
.venv/bin/python scripts/eval_run.py --compare tests/eval/results/v1-mini-full.json tests/eval/results/v2-mini2-full.json
```
