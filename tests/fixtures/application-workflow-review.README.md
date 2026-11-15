# Fictional application-workflow fixture

`application-workflow-review.json` was freshly generated for source tests from the public authored invoice-import app and `examples/heldout/fixtures/T01.json`. It was not copied from the production judge review, any Jira issue, an OAuth session or a real customer report. It contains no live account/site/project identifiers or credentials.

The fixture deliberately uses the complete source-side workflow-review format to test private-to-public projection, application/test binding, tamper rejection, AI context filtering and optional CI signatures. Its source/configuration/report commitments refer only to the public fictional input shipped in this repository. They are test data, not production evidence. The fixed public source is available to anyone who has this checkout.

Generation used Node.js24.22.3, the reusable `examples/heldout/profile.json`, and the ordinary local `run` then `export` commands. Both phases executed only the authored loopback HTTP app; no Atlassian, model or remote request occurred. Temporary generation directories were removed afterward. The generated fixture differs from the previously approved production fixture.

To refresh it after changing the trusted portable template/runtime or pinned authored application:

```sh
node scripts/reproshare-workflow.mjs run \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json --cwd "$PWD" \
  --allow-command --out NEW_TEMP_RESULTS

node scripts/reproshare-workflow.mjs export \
  --profile examples/heldout/profile.json \
  --source examples/heldout/fixtures/T01.json \
  --result NEW_TEMP_RESULTS/local-result.json --cwd "$PWD" \
  --reviewed-code --out NEW_TEMP_EXPORT
```

After reviewing the authored code, replace this test fixture with the fresh `NEW_TEMP_EXPORT/workflow-review.json`. Never use an actual customer or production packet as a source-test fixture. Other `judge-review-package*`, `judge-source-result*` and live evidence directories are not required by these tests.
