# Fix: vCPU Limit is 0 for GPU Instances

## What This Means

Your AWS account currently has **0 vCPU quota** for GPU instances (G family). This is normal for:
- Brand new AWS accounts
- Accounts not yet fully verified
- Free tier accounts

You need to request a limit increase before you can launch any GPU instances.

---

## ✅ Solution 1: Request vCPU Limit Increase (REQUIRED)

### Quick Steps:

1. **Go to Service Quotas Console**
   - Direct link: https://console.aws.amazon.com/servicequotas/

2. **Navigate to EC2**
   - Click "AWS services"
   - Search "EC2"
   - Click "Amazon Elastic Compute Cloud (Amazon EC2)"

3. **Find the Right Quota**
   - Search: **"Running On-Demand G and VT instances"**
   - Click on it

4. **Request Increase**
   - Click "Request quota increase"
   - **New quota value**: 8 (for 2x g5.xlarge) or 16 (recommended)
   - **Reason**: "Need GPU instance for AI video generation service (MuseTalk). Business use case: talking avatar videos."
   - Click "Request"

5. **Also Request Spot Quota**
   - Search: **"All G and VT Spot Instance Requests"**
   - Click on it
   - Request increase to: 8 or 16
   - Same reason as above

---

## ⏱️ How Long Will It Take?

### For New Accounts:
- **If account is verified**: 30 minutes - 24 hours
- **If account needs verification**: 1-3 business days
- **If payment method is new**: Up to 5 business days

### To Speed Up Approval:

1. **Verify your account**:
   - Confirm email
   - Add valid payment method
   - Verify phone number

2. **Add business justification** in your quota request:
   ```
   I am building an AI-powered video generation service that creates
   talking avatar videos using MuseTalk AI model. This requires GPU
   acceleration for real-time video processing. Expected usage: 4-8
   hours per day for development and production workloads.
   ```

3. **Start with smaller request**:
   - Request 8 vCPUs (not 32)
   - More likely to be auto-approved

---

## 🚀 Alternative: Use CPU Instances While Waiting

While waiting for GPU quota approval, you have options:

### Option A: RunPod or Vast.ai (FASTEST)

Use a different GPU provider for now:

**RunPod**:
- No quota limits
- GPU available immediately
- Cost: ~$0.20-0.40/hour
- Setup guide: See MUSETALK_GPU_SETUP.md

**Vast.ai**:
- No quota limits
- Cheaper: ~$0.15-0.30/hour
- Setup: Similar to RunPod

**Instructions**:
```bash
cd ~/WorkoutX/Links
cat MUSETALK_GPU_SETUP.md  # Original guide for RunPod/Vast.ai
```

### Option B: Test Without GPU (Limited)

Just for testing the setup process (won't actually work for videos):
- Use t3.medium or t3.large (CPU-only)
- No quota limits
- Cost: ~$0.04-0.08/hour
- Can test API server deployment
- Won't have CUDA/GPU for actual video generation

---

## 📋 Step-by-Step: Request Quota Increase

### Detailed Walkthrough:

```
Step 1: Go to Service Quotas
────────────────────────────
https://console.aws.amazon.com/servicequotas/

Step 2: AWS Services → EC2
────────────────────────────
Click "AWS services"
Type "EC2" in search
Click "Amazon Elastic Compute Cloud (Amazon EC2)"

Step 3: Find On-Demand Quota
────────────────────────────
Search box: "Running On-Demand G and VT"
Click on "Running On-Demand G and VT instances"
Current value will show: 0 vCPUs

Step 4: Request Increase
────────────────────────────
Click "Request quota increase"
Enter new value: 8
(This allows 2x g5.xlarge instances)

Step 5: Provide Justification
────────────────────────────
Case description:
  "I am setting up an AI video generation service (MuseTalk)
   that requires GPU acceleration for creating talking avatar
   videos. This is a business application with expected usage
   of 4-8 hours per day. I need g5.xlarge instance (4 vCPUs)
   for development and production workloads."

Step 6: Submit
────────────────────────────
Click "Request"
Check email for updates

Step 7: Repeat for Spot Instances
────────────────────────────
Search: "All G and VT Spot Instance Requests"
Request increase to: 8
Same justification
Submit
```

---

## 🔍 Check Request Status

### Monitor Your Request:

1. **Service Quotas Console** → **Dashboard** → **Recent quota requests**
2. Or check email for status updates

### Status Meanings:

- **Pending**: Being reviewed (wait)
- **Case opened**: Needs more info (check email)
- **Approved**: Ready to launch! ✅
- **Denied**: Need to provide more info and resubmit

---

## ⚠️ Common Issues

### Issue 1: Request Denied - Account Too New

**Solution**:
- Wait 24-48 hours after account creation
- Ensure payment method is verified
- Try again with detailed business justification

### Issue 2: Request Pending for Days

**Solution**:
- Check if AWS needs more information (check email)
- Reply to any AWS support emails promptly
- If >48 hours, contact AWS support

### Issue 3: No Response After 24 Hours

**Solution**:
1. Go to: https://console.aws.amazon.com/support/
2. Create support case
3. Subject: "Service quota increase request for EC2 G instances"
4. Include your quota request ID

---

## 💡 Pro Tips for Faster Approval

### 1. Verify Account First
```
✓ Email verified
✓ Phone number verified
✓ Valid payment method
✓ Identity verification complete
```

### 2. Start Small
- Request 8 vCPUs (not 32)
- Can always request more later
- Smaller requests auto-approve faster

### 3. Be Specific in Justification
**Bad**: "Need GPU for testing"
**Good**: "Building production AI video service, need GPU for MuseTalk model inference, ~100 videos/day"

### 4. Add Business Context
Mention:
- Production/business use (not hobby)
- Expected workload
- Why GPU is required
- Estimated usage hours

### 5. Request Both On-Demand and Spot
- "Running On-Demand G and VT instances"
- "All G and VT Spot Instance Requests"
- Request same amount for both

---

## 📊 What to Request

### Recommended Quota Request:

| Quota Type | Current | Request | Reason |
|------------|---------|---------|--------|
| Running On-Demand G and VT | 0 | 8 | Allows 2x g5.xlarge |
| All G and VT Spot Requests | 0 | 8 | Spot pricing for production |

### Why 8 vCPUs?

- **1x g5.xlarge** = 4 vCPUs (minimum needed)
- **2x g5.xlarge** = 8 vCPUs (recommended for flexibility)
- Higher numbers may need manual review

---

## 🚀 What to Do Right NOW

### Immediate Actions:

1. **Request quota increase** (2 minutes)
   - Follow steps above
   - Request 8 vCPUs for on-demand
   - Request 8 vCPUs for spot

2. **Choose temporary solution**:

   **Option A: Use RunPod/Vast.ai** (FASTEST)
   - Available immediately
   - No AWS quota needed
   - Follow: `MUSETALK_GPU_SETUP.md`
   
   **Option B: Wait for AWS approval** (1-48 hours)
   - Check email regularly
   - Continue once approved

3. **Verify AWS account**:
   - Double-check email is verified
   - Confirm payment method works
   - Complete phone verification

---

## 📧 Sample Quota Request Text

Copy and paste this (customize as needed):

```
Subject: GPU Instance Quota Increase Request

Description:
I am developing an AI-powered video generation application that creates
talking avatar videos using the MuseTalk AI model. This application 
requires GPU acceleration (CUDA) for efficient video processing and 
real-time generation.

Use Case Details:
- Application: MuseTalk AI video generation service
- Instance Type Needed: g5.xlarge (NVIDIA A10G GPU)
- Expected Usage: 4-8 hours per day for development and production
- Workload: Processing user-uploaded images and audio to generate 
  talking avatar videos
- Business Impact: Customer-facing production service

Requested Quota:
- Running On-Demand G and VT instances: 8 vCPUs
- All G and VT Spot Instance Requests: 8 vCPUs

This quota allows me to run 1-2 g5.xlarge instances for development, 
testing, and production workloads. I will use spot instances for cost 
optimization when possible.

Thank you for your consideration.
```

---

## ✅ Decision Tree

**Start Here**: Do you need to start immediately?

```
YES → Use RunPod or Vast.ai NOW
│     (Follow MUSETALK_GPU_SETUP.md)
│     Request AWS quota in parallel
│     Switch to AWS when approved
│
NO → Request AWS quota and wait
     (Follow this guide)
     Approval usually takes 1-24 hours
     Proceed with AWS setup once approved
```

---

## 🎯 Summary

**Problem**: AWS account has 0 vCPU quota for GPU instances
**Cause**: New account or account not verified
**Solution**: Request quota increase through Service Quotas Console

**Timeline**:
- Request submission: 5 minutes
- Approval: 30 minutes - 48 hours (typically < 24 hours)
- Can use RunPod/Vast.ai immediately while waiting

**Recommended Action**:
1. Request AWS quota NOW (5 minutes)
2. Use RunPod/Vast.ai while waiting (immediate)
3. Switch to AWS once quota approved (1-2 days)

---

## 📞 Need Help?

### If quota request is taking too long:

1. **AWS Support Console**: https://console.aws.amazon.com/support/
2. Create case: "Service Limit Increase"
3. Include your quota request ID

### If denied or need more info:

1. Reply to AWS email with more details
2. Emphasize business use case
3. Mention production workload
4. Can request phone call with AWS rep

---

**Bottom line: Request the quota increase now, then use RunPod/Vast.ai while you wait! You can switch to AWS in 1-2 days.** 🚀
