# Quick Start: AI Audio Transcription

## 🚀 How to Start Flask with AI Enabled

**IMPORTANT**: Replace `sk-proj-YOUR-KEY-HERE` with your actual OpenAI API key in all commands below.

### Option 1: Using the Startup Script (Recommended)

```bash
export OPENAI_API_KEY='sk-proj-YOUR-KEY-HERE'
./start_with_openai.sh
```

### Option 2: Manual Start

```bash
export OPENAI_API_KEY='sk-proj-YOUR-KEY-HERE'
python3 bodybuilding_app.py
```

### Option 3: One-liner (for PythonAnywhere or remote server)

```bash
OPENAI_API_KEY='sk-proj-YOUR-KEY-HERE' python3 bodybuilding_app.py
```

---

## 🔍 Verify It's Working

After restarting Flask, watch your logs when uploading an audio post. You should see:

**✅ Success:**
```
Generating AI summary for audio post: uploads/audio/audio_20251029_124910.mp4
Processing audio for AI summary: uploads/audio/audio_20251029_124910.mp4
Transcribing audio file: uploads/audio/audio_20251029_124910.mp4
Transcription successful: Hello, this is my workout update...
Summarizing text of length: 150
Summary created: User discusses workout routine
AI summary generated successfully
```

**❌ Failure (means API key not set):**
```
OpenAI not available or API key not set, skipping transcription
```

---

## 📱 For PythonAnywhere Users

If you're on PythonAnywhere:

1. Go to **Web tab**
2. Scroll to **Environment variables**
3. Add:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: `sk-proj-YOUR-KEY-HERE` (paste your actual OpenAI API key)
4. Click **Reload** button at the top

---

## 🧪 Test Without Restarting Flask

You can verify the OpenAI setup works:

```bash
export OPENAI_API_KEY='sk-proj-YOUR-KEY-HERE'
python3 -c "from openai import OpenAI; import os; client = OpenAI(api_key=os.environ['OPENAI_API_KEY']); print('✅ OpenAI works!')"
```

---

## 💡 Common Issues

### Issue: "OpenAI not available or API key not set"
**Solution**: Flask process doesn't have the environment variable. Restart Flask using one of the methods above.

### Issue: Can't find `bodybuilding_app.py`
**Solution**: Make sure you're in `/workspace` directory:
```bash
cd /workspace
```

### Issue: Permission denied on `start_with_openai.sh`
**Solution**: Make it executable:
```bash
chmod +x start_with_openai.sh
```
