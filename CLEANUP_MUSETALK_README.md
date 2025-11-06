# MuseTalk Local Installation Cleanup

Since we're now using the GPU API approach, you can safely remove all local MuseTalk files to free up disk space.

## What Will Be Removed

- ✅ `MuseTalk/` directory (~2-5GB of models and code)
- ✅ `musetalk_env/` virtual environment (~1-2GB)
- ✅ PyTorch and dependencies (~1-3GB)
- ✅ mmcv, mmpose, mmdet, transformers
- ✅ Downloaded model weight files
- ✅ pip cache

## What Will Be KEPT

- ✅ Your main app code
- ✅ Essential packages (numpy, opencv, requests, Pillow)
- ✅ Database and user data
- ✅ All other functionality

## Expected Space Savings

**~5-10GB** of disk space will be freed up!

---

## Instructions

### Step 1: Pull Latest Code

```bash
cd ~/WorkoutX/Links
git pull origin main
```

### Step 2: Run Cleanup Script

```bash
cd ~/WorkoutX/Links
bash cleanup_musetalk_local.sh
```

This will:
1. Show disk usage BEFORE cleanup
2. Ask for confirmation
3. Remove MuseTalk files and dependencies
4. Show disk usage AFTER cleanup
5. Report space freed

### Step 3: Verify Cleanup

```bash
python3 verify_musetalk_removed.py
```

This checks:
- ✅ All directories removed
- ✅ All packages uninstalled
- ✅ API configuration present
- ✅ Essential packages still installed

---

## Example Output

```bash
$ bash cleanup_musetalk_local.sh

==================================================
MuseTalk Local Installation Cleanup
==================================================

This will remove:
  - MuseTalk directory and models (~2-5GB)
  - MuseTalk virtual environment (~1-2GB)
  - Heavy ML dependencies (PyTorch, mmcv, etc.)
  - Model weight files

Continue? (y/n) y

Starting cleanup...

=== Disk Usage BEFORE ===
/dev/sda1       50G   33G   15G  69% /

📁 Removing MuseTalk directory...
3.2G    MuseTalk
✅ MuseTalk directory removed

📁 Removing MuseTalk virtual environment...
1.8G    musetalk_env
✅ musetalk_env removed

📦 Uninstalling heavy ML packages...
  Uninstalling torch...
  Uninstalling torchvision...
  ...
✅ Heavy packages uninstalled

=== Disk Usage AFTER ===
/dev/sda1       50G   28G   20G  58% /

==================================================
✅ Cleanup Complete!
==================================================

Freed up space by removing:
  ✅ MuseTalk models and code
  ✅ Virtual environment
  ✅ PyTorch and ML dependencies

Your app will now use the GPU API for talking avatars.
Make sure MUSETALK_API_URL and MUSETALK_API_SECRET are set in .env
```

---

## Verify Everything Works

After cleanup, test your app:

1. Make sure API is configured in `.env`:
   ```bash
   MUSETALK_API_URL=https://your-gpu-url
   MUSETALK_API_SECRET=your-secret
   ```

2. Restart your app:
   ```bash
   touch /var/www/puntz08_pythonanywhere_com_wsgi.py
   ```

3. Test talking avatar generation
4. Check logs:
   ```bash
   tail -f ~/WorkoutX/Links/server.log
   ```

Expected log output:
```
[MuseTalk API] Generating video: /path/to/image.jpg + /path/to/audio.wav
[MuseTalk API] Using server: https://your-gpu-url
[MuseTalk API] Video generated! Job ID: abc-123
```

---

## Troubleshooting

### "Some packages still installed"

Some packages may be dependencies of other software. That's OK! The script removes the heavy ones (PyTorch, mmcv, etc.).

### "API not configured"

Add these to your `.env` file:
```bash
MUSETALK_API_URL=https://your-ngrok-url
MUSETALK_API_SECRET=your-secret-key
```

### "Permission denied"

Make sure scripts are executable:
```bash
chmod +x cleanup_musetalk_local.sh verify_musetalk_removed.py
```

---

## Rollback (If Needed)

If you need to restore local MuseTalk for any reason:

```bash
cd ~/WorkoutX/Links

# Re-clone MuseTalk
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk
bash scripts/download_weights.sh

# Reinstall dependencies
pip3 install --user torch torchvision torchaudio
pip3 install --user -r requirements.txt
```

But remember: local MuseTalk won't work due to cgroup limits on your server!

---

## Summary

- ✅ Safe to run (only removes MuseTalk-related files)
- ✅ Frees 5-10GB of disk space
- ✅ Your app continues working via GPU API
- ✅ Can be reversed if needed (though not recommended)

**Run this on both your `main` and `develop` branches!**
