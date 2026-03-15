Run tests for the specified file or the full test suite.

Steps:
1. If $ARGUMENTS is empty, run the full test suite:
   - `python3 -m pytest api-tests/ -v --tb=short`
   - `npx playwright test --reporter=list`
2. If $ARGUMENTS is a test file (starts with `api-tests/` or `e2e-tests/`), run it directly:
   - API: `python3 -m pytest $ARGUMENTS -v --tb=short`
   - E2E: `npx playwright test $ARGUMENTS --reporter=list`
3. If $ARGUMENTS is a source file, look up `scripts/test-map.json` for mapped tests and run them
4. Report pass/fail results concisely
