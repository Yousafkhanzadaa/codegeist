# Optional public-artifact CI provenance

Status: the local Ed25519 signing/verification tool and its negative tests are implemented. **No provider-backed CI run or OIDC attestation has been verified for this project.** The example workflow is not installed by placing it in this repository; it is prepared for future authorised use. Forge evidence remains a local self-report; this optional component does not upgrade its level or bypass human approval.

The tool binds the exact public fixture, application runner, public verification receipt and predeclared test specification to declared application-file build pins and a specific job identity. Verification requires a signing key and expected job/build policy supplied separately by the verifier. An uploaded envelope cannot choose its own trusted key. A signature demonstrates integrity under that trust policy; it does not establish that code ran or that a provider issued the signature.

Public inputs are `fixture.json`, `application-reproducer.mjs`, `verification-spec.json` and `public-verification.json`. Obtain the last two from the approved package's public MCP fields or source-authorised public projection. Never substitute `workflow-review.json`, `local-result.json`, a private local verification report, the original customer input or a profile containing commands. The tool rejects private report kinds and extra commitment fields. Review all public code/data first; schema and metadata can still disclose information.

Create a statement from the actual public files:

```sh
node scripts/reproshare-ci.mjs manifest \
  --public-receipt public-verification.json --fixture fixture.json \
  --runner application-reproducer.mjs --test-spec verification-spec.json \
  --job expected-job.json --out artifact-manifest.json
```

`expected-job.json` specifies provider, repository, source commit, workflow path, run ID/attempt and job ID. These values are declared metadata until independently checked. The build digest covers the predeclared affected revision and file hashes, not an undeclared dependency closure or a container image. Public receipt integrity, fixture/test bindings and basic reproduction states are checked before a statement is created.

For an organisation already maintaining a separately trusted Ed25519 signer:

```sh
node scripts/reproshare-ci.mjs sign --manifest artifact-manifest.json \
  --key-id approved-ci-key --private-key /private/ci-signing.pem --out signed.json

node scripts/reproshare-ci.mjs verify --signed signed.json --trust trusted-policy.json \
  --public-receipt public-verification.json --fixture fixture.json \
  --runner application-reproducer.mjs --test-spec verification-spec.json \
  --out verified.json
```

The verifier obtains `trusted-policy.json` independently of the uploaded receipt, pins the signer key and expected job/build, and recomputes hashes from the received public files. Do not copy a key or expected identity from the envelope into the trust policy just to make verification pass. The example policy contains intentional placeholders and is not a working or pretrusted production configuration. The test suite generates temporary local keys; no private signing key is shipped.

Success remains explicit: `execution: "not-attested"` and `providerIdentity: "not-verified-by-this-tool"`. Signed data from a trusted key can still contain a false execution claim. Preserve the source operator's self-report and separately inspect/replay the synthetic test.

For provider provenance, [GitHub's current documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) uses the `attest` action and OIDC/attestation permissions. The supplied [workflow template](../examples/ci/reproshare-public.yml) runs the reviewed synthetic input, then attests the resulting public manifest. It uploads only named public files. No original input is required. `actions/attest-build-provenance` now wraps the newer action, and its maintainers recommend `actions/attest` for new integrations. [Official action](https://github.com/actions/attest), [wrapper notice](https://github.com/actions/attest-build-provenance)

The template uses the official documented major versions checked on 15 November 2026: checkout/setup-node/upload-artifact v7 and attest v4. Before treating the workflow as a trusted builder, review its source/actions and pin reviewed commit SHAs under the organisation's normal policy. It is not installed merely by existing in this examples directory. [Checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), [artifact upload](https://github.com/actions/upload-artifact)

After a real provider run, verify the downloaded manifest against identities chosen independently of that manifest:

```sh
gh attestation verify artifact-manifest.json \
  --repo EXPECTED_OWNER/EXPECTED_REPO \
  --signer-workflow EXPECTED_OWNER/EXPECTED_REPO/.github/workflows/reproshare-public.yml \
  --source-digest EXPECTED_SOURCE_COMMIT \
  --deny-self-hosted-runners --format json
```

The repository, signer workflow and source commit must be the expected ones, rather than whatever an uploaded receipt says. Reusable workflows have a distinct signer identity. GitHub's CLI documentation also distinguishes certificate/timestamp identity from workflow-controlled predicate metadata; a trusted reviewed workflow remains necessary. [Official verification and policy flags](https://cli.github.com/manual/gh_attestation_verify)

No GitHub verification command was run for this project, and the local tool does not parse arbitrary saved `gh` output as proof. Once an authorised provider run exists, retain its actual verification result, provider URL and exact public artifact hashes. That would add independently verifiable build provenance; whether it establishes a test's execution still depends on the trusted workflow and test semantics.

The integration API is `createCiStatement`, `signCiStatement`, `parseCiTrustPolicy`, and `verifyCiStatement` in `local/ci-provenance.mjs`. CLI operation is offline; it neither sends messages nor writes Jira. Parent application integration should display optional signature provenance separately from reproduction level and human approval.
