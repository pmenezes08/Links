#!/usr/bin/env bash
# Wrapper script for PythonAnywhere always-on task.
# Ensures the keep-warm loop runs with the required environment variables.

set -euo pipefail

export KEEP_WARM_COOKIE="cpoint_session=eyJfcGVybWFuZW50Ijp0cnVlLCJ1c2VybmFtZSI6IlBhdWxvIn0.aTTyHA.AQ4fNKFNpJp4ct2Bpex5qWupl50"

cd /home/puntz08
exec python3 keep_warm.py
