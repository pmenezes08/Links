# Cloud Monitoring Alerts — cpoint-app (prod)

Four alert policies covering the core "something is wrong" signals on the
production Cloud Run service. Apply from Cloud Shell (where `gcloud beta`
is already available) with the commands below.

## Prerequisites

1. A notification channel must exist. If not, create an email one first:

   ```bash
   gcloud beta monitoring channels create \
     --display-name="Founder email" \
     --type=email \
     --channel-labels=email_address=paulo.miguel.menezes@gmail.com
   ```

   Capture the channel name (looks like
   `projects/cpoint-127c2/notificationChannels/1234567890`).

2. Export it for reuse:

   ```bash
   export CHAN="projects/cpoint-127c2/notificationChannels/XXXXXXXXXX"
   ```

## Apply all four policies

```bash
for f in cpu_high.json memory_high.json latency_p95_high.json concurrency_high.json; do
  gcloud alpha monitoring policies create \
    --policy-from-file="$f" \
    --notification-channels="$CHAN"
done
```

## Verify

```bash
gcloud alpha monitoring policies list \
  --format="table(displayName,enabled)" \
  --filter="displayName~'cpoint-app'"
```

Expected: four rows, all `True`.

## Why these four

- **CPU > 80%** — sustained compute pressure; usually a hot loop or a sudden
  traffic spike.
- **Memory > 80%** — precursor to the container getting OOM-killed (we're
  on 1GiB, so memory is the tighter bound than CPU in practice).
- **p95 latency > 2s** — user-visible slowness. Covers DB stalls and
  Grok/OpenAI tool-call blow-ups.
- **Concurrent requests > 60** — Cloud Run default concurrency is 80 per
  instance; breaching 60 means we're one burst away from autoscale churn
  or dropped requests.

Tune thresholds downward once we have a baseline from 2–3 weeks of
BigQuery billing export data (see `docs/OPERATIONS.md` §0).
