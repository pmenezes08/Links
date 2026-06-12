# Backup snapshot (pre prod sync, 2026-06-12)

Created before fast-forwarding `main` to `staging` (55 commits: Steve asks epic,
Tier-1 You page, empty-dashboard redesign) and deploying both environments.

## Git

| Item | Value |
|------|-------|
| Tag | `backup-pre-prod-sync-2026-06-12` |
| Branch | `backup/pre-prod-sync-2026-06-12` |
| Staging tip at backup | `2faf45fa7` (plus the snapshot-doc commit the tag points at) |
| `main` tip before sync | `2fec2efb4` — restore main without the 55 staging commits from here |

**Rollback code:** `git checkout backup-pre-prod-sync-2026-06-12` then
`gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .` (staging)
or `--config=cloudbuild-production.yaml` (prod).

## Cloud Run (pre-deploy revisions — traffic rollback targets)

| Service | Revision |
|---------|----------|
| `cpoint-app` (prod) | `cpoint-app-00508-trv` |
| `cpoint-app-staging` | `cpoint-app-staging-01175-txd` |

**Rollback traffic (prod example):**

```powershell
gcloud run services update-traffic cpoint-app `
  --region=europe-west1 --project=cpoint-127c2 `
  --to-revisions=cpoint-app-00508-trv=100
```

## Cloud SQL

On-demand backup of `cpoint-db` created 2026-06-12 (shared by prod and staging).
List/restore: `gcloud sql backups list --instance=cpoint-db --project=cpoint-127c2`.

## Media / other state

R2 media, Firestore mirrors, and Secret Manager are managed services with their
own durability; no point-in-time action taken here.
