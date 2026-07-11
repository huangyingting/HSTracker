# Candidate Market Score presentation prototype

Throwaway UI for
[Prototype the Candidate Market Score presentation](https://github.com/huangyingting/HSTracker/issues/10).
It keeps the accepted focused workspace fixed and varies the selected market's
score explanation.

Run:

```sh
python3 -m http.server 4173 --directory prototype/candidate-market-score-presentation
```

Open:

- `http://localhost:4173/?variant=A` - weighted evidence stack;
- `http://localhost:4173/?variant=B` - audit worksheet; or
- `http://localhost:4173/?variant=C` - evidence-first narrative.

Use the floating arrows or keyboard left/right arrows to switch. Select
different markets to inspect computed, neutral, missing, and low-confidence
states.

The normal `Latest known release` scope is held constant here. Alternate
refresh states were settled by the freshness decision and are intentionally not
re-prototyped in this score-focused artifact.

All values are illustrative. This code is a primary-source prototype, not
production implementation.
