# Staging backup snapshot (pre native UX epic)

Created before the native UX + monolith reduction epic (2026-05-26).

## Git

| Item | Value |
|------|-------|
| Commit | `f8869bcca` |
| Tag | `staging-backup-pre-native-ux-epic-2026-05-26` |
| Branch | `backup/staging-backup-pre-native-ux-epic-2026-05-26` |

**Rollback code:** `git checkout staging-backup-pre-native-ux-epic-2026-05-26` then `gcloud builds submit --config=cloudbuild.yaml --project=cpoint-127c2 .`

## Cloud Run (`cpoint-app-staging`)

| Item | Value |
|------|-------|
| URL | `https://cpoint-app-staging-739552904126.europe-west1.run.app` |
| Revision | `cpoint-app-staging-01003-snh` |

**Rollback traffic:**

```powershell
gcloud run services update-traffic cpoint-app-staging `
  --region=europe-west1 --project=cpoint-127c2 `
  --to-revisions=cpoint-app-staging-01003-snh=100
```

## Cloud SQL

Take an on-demand backup before Wave 4 (DM send routes):

```powershell
gcloud sql backups create --instance=cpoint-db --project=cpoint-127c2
```
