# 🔧 Jenkins Setup Guide - NVD Playwright Tests

This guide walks you through setting up a Jenkins job to run NVD Playwright tests with Teams notifications.

## 📋 What This Jenkins Job Does

- ✅ Runs NVD Playwright E2E tests daily (08:00 UTC / 13:30 IST)
- ✅ Supports manual trigger anytime
- ✅ Stores test results, screenshots, and reports as Jenkins artifacts
- ✅ Sends Teams notifications with:
  - Test status (PASSED/FAILED)
  - Build number and link
  - Environment (staging/production)
  - Direct links to test reports

---

## 📁 Files You Need

1. **Jenkinsfile.NVD** - Jenkins pipeline definition
   - Located in: `Dashboard-Alerts/` folder
   - Defines all pipeline stages
   - Handles Teams notifications

2. **GitHub Actions Workflow Files** - For reference
   - `.github/workflows/playwright-tests.yml`
   - These serve as the template we converted to Jenkins

---

## 🔑 Step 1: Create Jenkins Credentials

Go to: **Jenkins > Manage Jenkins > Manage Credentials > System > Global credentials**

### Create 4 Secret Credentials:

#### 1️⃣ **nvd-ccma-username** (Secret text)
```
Description: NVD CCMA Login Username
Secret: [your CCMA username]
ID: nvd-ccma-username
```

#### 2️⃣ **nvd-ccma-password** (Secret text)
```
Description: NVD CCMA Login Password
Secret: [your CCMA password]
ID: nvd-ccma-password
```

#### 3️⃣ **nvd-test-environment-url** (Secret text)
```
Description: NVD Test Environment URL
Secret: https://inutilidcplp322.idc1.level3.com:8483
ID: nvd-test-environment-url
```

#### 4️⃣ **nvd-teams-webhook-url** (Secret text)
```
Description: Teams Webhook URL for NVD Notifications
Secret: [your Teams webhook URL]
ID: nvd-teams-webhook-url
```

**Screenshot of credentials page should show:**
```
✅ nvd-ccma-username
✅ nvd-ccma-password
✅ nvd-test-environment-url
✅ nvd-teams-webhook-url
```

---

## 📦 Step 2: Create Jenkins Pipeline Job

### Option A: Using Jenkinsfile from GitHub (RECOMMENDED)

1. Go to: **Jenkins > New Item**
2. Choose: **Pipeline**
3. Name: `NVD-Playwright-Tests`
4. Click **OK**

### Configure Pipeline Source:

1. Go to: **Pipeline > Definition**
2. Choose: **Pipeline script from SCM**
3. SCM: **Git**
4. Repository URL: `https://github.com/SaiVikas-Panthangi/NVD.git`
5. Credentials: (add your GitHub credentials if private)
6. Branch: `*/main`
7. Script Path: `Jenkinsfile.NVD`

**Click SAVE** ✅

### Option B: Using Direct Jenkinsfile Content

If you prefer to paste the Jenkinsfile directly:

1. Go to: **Jenkins > New Item > Pipeline**
2. Name: `NVD-Playwright-Tests`
3. Go to: **Pipeline > Definition**
4. Choose: **Pipeline script**
5. Paste the entire content from `Jenkinsfile.NVD`
6. Click **SAVE** ✅

---

## 🧪 Step 3: Run Your First Test

### Manual Trigger:

1. Go to: **Jenkins > NVD-Playwright-Tests**
2. Click: **Build with Parameters** (left sidebar)
3. Choose Environment: `staging` or `production`
4. Click: **Build**

**Pipeline Stages:**
```
✅ Checkout                    (Get code from GitHub)
✅ Validate Credentials        (Check all secrets exist)
✅ Setup Node.js               (Check versions)
✅ Install Dependencies        (npm ci)
✅ Install Playwright Browsers (chromium)
✅ Run Playwright Tests        (npm run test)
✅ Collect Test Reports        (Find artifacts)
✅ Archive Artifacts           (Save to Jenkins)
✅ Send Teams Notification     (Post result to Teams)
```

---

## 📊 Step 4: Verify Everything Works

### Check Build Log:
1. Click on the build number (e.g., `#1`)
2. Go to: **Console Output**
3. Look for: `✅ All credentials configured`
4. Look for: `🧪 Running Playwright E2E Tests`
5. Look for: `📢 Sending Teams notification...`

### Check Jenkins Artifacts:
1. Go to: **Build #1 > Artifacts**
2. Should see:
   - `playwright-report/` - HTML test report
   - `screenshots/` - Failed test screenshots
   - `test-results/` - JSON test results

### Check Teams Notification:
Look for message in your Teams channel with:
```
✅ NVD Playwright Tests PASSED
Build #1
Environment: staging
Status: SUCCESS
```

---

## 📅 Step 5: Configure Daily Schedule (Optional)

The Jenkinsfile already includes a daily schedule:
```
- Daily at 08:00 UTC (13:30 IST)
- Automatic trigger, no manual action needed
```

To modify the schedule:

1. Edit `Jenkinsfile.NVD`
2. Change this section:
```groovy
triggers {
  cron('''TZ=UTC
0 8 * * *''')  // Change this timing
}
```

**Cron Syntax:**
- `0 8 * * *` = Daily at 08:00 UTC
- `30 3-17 * * *` = Hourly 09:00-23:00 IST

---

## 🔗 Integration Flow

```
NVD GitHub Repo (main branch)
        ↓
    Jenkinsfile.NVD
        ↓
Jenkins pulls code every build
        ↓
Runs: npm run test
        ↓
Generates: playwright-report/
           screenshots/
           test-results/
        ↓
Jenkins Archives Artifacts
        ↓
Sends Teams Notification
        ↓
Teams Channel receives: 
  ✅ Build Status
  📊 Test Results
  🔗 Links to Reports
```

---

## 🚨 Troubleshooting

### ❌ Error: "Missing credential: nvd-ccma-username"
**Solution:** Create the credentials in Jenkins (Step 1)

### ❌ Error: "npm: command not found"
**Solution:** 
- Node.js/npm not installed on Jenkins agent
- Install Node.js on Jenkins server

### ❌ Tests fail but no Teams notification
**Solution:**
1. Check Teams webhook URL is correct
2. Verify network connectivity to Teams
3. Check Jenkins logs for curl/webhook errors

### ❌ "Refusal to merge unrelated histories"
**Solution:** Don't worry, this is just for git syncing. Jenkins pulls directly from repo.

---

## 📝 Files Reference

| File | Location | Purpose |
|------|----------|---------|
| `Jenkinsfile.NVD` | Dashboard-Alerts/ | Main pipeline definition |
| `playwright-tests.yml` | NVD/.github/workflows/ | GitHub Actions equivalent (for reference) |
| `package.json` | NVD/ | Test scripts and dependencies |

---

## ✅ Verification Checklist

Before declaring victory:

- [ ] Created all 4 Jenkins credentials
- [ ] Created Pipeline job named `NVD-Playwright-Tests`
- [ ] Configured job to use Jenkinsfile from GitHub
- [ ] Built job manually - all stages passed
- [ ] Saw test results in Jenkins artifacts
- [ ] Received Teams notification in channel
- [ ] Can manually trigger build anytime
- [ ] Daily schedule will run at 08:00 UTC

---

## 🎯 Next Steps

1. **Setup is complete!** Jenkins will now run tests daily
2. **Monitor builds** in: Jenkins > NVD-Playwright-Tests > Build History
3. **Check Teams** for daily notifications
4. **View reports** by clicking artifact links in Jenkins

---

## 📞 Quick Reference

| Task | Location |
|------|----------|
| View builds | Jenkins > NVD-Playwright-Tests > Build History |
| Manual trigger | Jenkins > NVD-Playwright-Tests > Build with Parameters |
| View logs | Jenkins > Build #X > Console Output |
| Download reports | Jenkins > Build #X > Artifacts |
| Configure credentials | Jenkins > Manage Jenkins > Manage Credentials |
| Edit pipeline | GitHub > NVD repo > Jenkinsfile.NVD |

---

**✨ Your Jenkins NVD Test Pipeline is Ready!**
