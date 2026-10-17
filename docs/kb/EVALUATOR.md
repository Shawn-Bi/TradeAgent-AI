# PRISM evaluator: translation faithfulness (v1 vs v2)

**Do not upload this file to the Knowledge Base.** It is the rubric for PRISM's Evaluators Hub, not a source for the
agent. Upload only the four sources listed in [README.md](README.md).

## What the judge sees

PRISM fills three variables from each trace of agent `tradeagent-strategy-translator`:

- `{input}`: the user message, `BASE_SPEC (defaults): {...}` followed by `TRADER_TEXT: <<< ... >>>`.
- `{output}`: the translator's raw JSON, `{"overrides", "clarification_questions", "unsupported_requirements",
  "interpretation_notes"}`.
- `{context}`: for v2, the `knowledge_base_search` span (retrieved `docs/kb` snippets). For v1 there is no retrieval
  step, so PRISM puts a line saying nothing was retrieved.

The rubric carries its own unit table, so v1 and v2 traces are judged by the same rules on the same inputs. Context
is only reference material and never earns or costs points by itself.

## Evaluator settings

- **Name:** `Translation faithfulness`
- **Scale:** 0 to 1
- **Traces:** agent `tradeagent-strategy-translator`, filtered on metadata `prompt_version` = `v1`, then `v2`. The
  harness gives each batch its own sessions (`eval-v1-<tag>-<input id>`, `eval-v2-<tag>-<input id>`).
- **Cost:** 1 credit per trace scored, so about 126 credits for 63 inputs × 2 versions.

## Rubric (paste into the Evaluators Hub)

```text
You are grading one call of a strategy translator in a SIMULATION-ONLY paper-trading demo. The translator turns a
trader's plain-English rules into a JSON patch ("overrides") for a fixed strategy on the fictional instrument NG_SIM.

INPUT (the trader's text is between <<< and >>> after TRADER_TEXT; BASE_SPEC holds the defaults):
{input}

OUTPUT (the translator's JSON):
{output}

REFERENCE CONTEXT (retrieved documents; may say nothing was retrieved). Use it only to check units and field names.
It is never a source of values the trader did not state:
{context}

Fixed facts:
- Distances are in TICKS. 1 tick = 0.001 price units = $10 per contract. Tick fields: stop.buffer_ticks,
  entry.tolerance_ticks.
- "points", "pips", "cents", dollar amounts, percentages and bare numbers with no unit are NOT ticks. The only
  exact conversion is a price decimal that is a whole multiple of 0.001 (0.004 -> 4 ticks).
- exit.target_r is a multiple of initial risk ("1.5R", "1.5 times risk", "2:1"). "15 ticks" is not an R multiple.
- exit.first_target_close_contracts is a contract count. "Half" of an even quantity is exact (half of 4 = 2;
  the default quantity is 2, so half = 1). Half or a third of an odd or non-divisible quantity is ambiguous.
- Unsupported: short selling, trailing or breakeven stops, time-of-day windows ("skip the first 15 minutes"),
  EMA/RSI/other indicators, averaging down, scaling in, pyramiding, overnight holds, other instruments, turning a
  risk limit off. These belong in unsupported_requirements and must not be imitated with another field.
- Negated restatements ("no shorts", "never hold overnight") need nothing.
- The translator must never set schema_version, strategy_id, version, approval_status, simulation_only,
  account_id, instrument or direction.

Check every key in OUTPUT.overrides and every instruction in the trader's text:
1. Stated values only: each override value is written in the trader's text or follows from it by an exact rule
   above ("3:30 pm" -> "15:30", "six" -> 6). A value the trader never gave is INVENTED.
2. Units: a tick field filled from points, pips, cents, dollars, percent or a unitless number is a UNIT ERROR.
3. Ambiguity: a vague ("tight stop", "a few contracts", "a bit more room") or contradictory instruction must become
   a clarification question, not a value.
4. Unsupported: each unsupported ask appears in unsupported_requirements (or a clarification question) and is not
   approximated by another field.
5. Coverage: each clear, supported instruction with a stated value is applied.
6. Format: OUTPUT is one JSON object with the four keys.

Score, starting at 1.0:
- 0.0 if any value is INVENTED, any UNIT ERROR, any unsupported ask is approximated with another field, a
  protected key is set, or OUTPUT is not valid JSON.
- At most 0.4 if an ambiguous or unsupported instruction is silently dropped (no value, no question, not listed).
- Minus 0.3 for each clear, supported, stated value that is missing from overrides.
- Minus 0.2 if it asks a question about an instruction that was already clear and supported.
Clamp to [0, 1].

Reply with the score and one sentence naming the field or instruction that decided it.
```

## Root Cause (needs 50+ traces first)

Run the v1 batch (`python scripts/eval_run.py --prompt-version v1 --tag <tag>`), then open PRISM Root Cause for
agent `tradeagent-strategy-translator`. A genuine cluster needs at least 3 failed runs. The harness writes each
failure's reason (`invented:`, `forbidden:`, `not_asked`, `missed:`) to `tests/eval/results/v1-<tag>.json`, so
the cluster PRISM finds can be checked against concrete inputs. Failures come from the translator only: the risk
gate, approval and the deterministic engine stay on throughout.
