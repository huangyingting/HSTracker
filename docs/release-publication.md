# Release publication

Accepted analysis and product-search artifacts are published as one exact,
immutable deployment pairing. Promotion verifies every uploaded object by
reading and hashing it before atomically replacing the current pointer.

## Candidate directories

`npm run release:promote` accepts two directories:

| Analysis directory | Product-catalog directory |
|---|---|
| `candidate-market.duckdb` | `product-catalog.json` |
| `artifact-manifest.json` | `catalog-manifest.json` |
| `artifact-build-report.json` | `catalog-build-report.json` |

Both reports must be accepted, each manifest must match its report byte for
byte, and every artifact must match its manifest. The analysis and product
catalog must name the same BACI release, source archive SHA-256, and HS12
revision.

## Object storage

Configure the S3-compatible private bucket through the environment:

| Variable | Required | Purpose |
|---|---|---|
| `HS_TRACKER_RELEASE_S3_BUCKET` | Yes | Private release bucket |
| `HS_TRACKER_RELEASE_S3_REGION` | Yes | S3 signing region |
| `HS_TRACKER_RELEASE_S3_ENDPOINT` | No | Custom S3-compatible endpoint |
| `HS_TRACKER_RELEASE_S3_FORCE_PATH_STYLE` | No | `true` for path-style endpoints; otherwise `false` |

Promotion uses the write-scoped credential variables:

- `HS_TRACKER_RELEASE_WRITE_ACCESS_KEY_ID`
- `HS_TRACKER_RELEASE_WRITE_SECRET_ACCESS_KEY`
- `HS_TRACKER_RELEASE_WRITE_SESSION_TOKEN` (optional)

Runtime hydration uses the distinct read-only variables:

- `HS_TRACKER_RELEASE_READ_ACCESS_KEY_ID`
- `HS_TRACKER_RELEASE_READ_SECRET_ACCESS_KEY`
- `HS_TRACKER_RELEASE_READ_SESSION_TOKEN` (optional)

Set an access-key ID and secret together. If a scoped pair is omitted, the AWS
SDK default credential provider chain supplies the process identity. Deploy the
runtime and promotion commands with different identities: runtime needs only
`s3:GetObject`, while promotion needs `s3:GetObject` and `s3:PutObject`. Never
pass credentials as command-line arguments.

Published objects use these key families:

```text
releases/{baciRelease}/{artifactSha256}/...
product-search-catalogs/{productSearchBuildId}/{catalogSha256}/...
analysis-release-catalogs/{catalogSha256}.json
deployment-pairings/{deploymentPairingId}.json
deployment-pointers/current.json
```

Only `deployment-pointers/current.json` is mutable. S3 conditional writes make
pointer activation compare-and-swap. Artifact and catalog manifests use their
own SHA-256-addressed keys beneath those prefixes, so metadata-only rebuilds
cannot collide. All immutable writes require the key not to exist and permit
only identity-equivalent retries. Public deployment metadata contains object
keys and content identities, never bucket URLs or credentials.

## Promote and roll back

```bash
npm run release:promote -- \
  --analysis-directory /path/to/accepted-analysis \
  --product-catalog-directory /path/to/accepted-product-catalog \
  --activated-at 2026-07-12T02:00:00Z
```

The timestamp must be UTC without fractional seconds. The command prints the
activated deployment identity as JSON. A failed upload, read-back, pairing
check, or conditional pointer write leaves the active deployment unchanged.

After at least two pairings have been activated, swap current and previous
atomically:

```bash
npm run release:rollback -- \
  --activated-at 2026-07-12T04:00:00Z
```

Rollback is reversible because it retains the displaced pairing as previous.

## Runtime hydration

`ReleaseHydrator.hydrateCurrent()` uses the read-only object reader. It streams
the current pairing into a process-specific `.partial` directory, verifies byte
counts and SHA-256 identities, fsyncs files and directories, and atomically
renames the complete pairing into the serving volume. Existing resident
pairings are fully reverified before reuse.

## Local S3-compatible integration

Docker is required for the S3 adapter suite. The test starts a MinIO release
pinned by image digest, creates an isolated bucket, exercises streaming uploads,
checksum enforcement, conditional pointer writes, credential separation, and
the promotion/rollback commands, then removes the container:

```bash
npm test -- tests/integration/s3-release-object-store.test.ts
```
