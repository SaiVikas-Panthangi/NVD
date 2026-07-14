# GitHub Actions Quick Reference Card

## 🚀 Quick Start Commands

### **Self-Hosted Runner Management**

```powershell
# ✅ Start runner service
Get-Service | Where-Object {$_.Name -like "*GitHubActionsRunner*"} | Start-Service

# ⏸️ Stop runner service
Get-Service | Where-Object {$_.Name -like "*GitHubActionsRunner*"} | Stop-Service

# 🔄 Restart runner service
Get-Service | Where-Object {$_.Name -like "*GitHubActionsRunner*"} | Restart-Service

# 📊 Check runner status
Get-Service | Where-Object {$_.Name -like "*GitHubActionsRunner*"}

# 🏗️ Runner directory
cd "C:\GitHub\Actions-Runner"
```

---

## 📋 Setup Checklist

| Step | Task | Command/Link | Status |
|------|------|---------|--------|
| 1 | Download Runner | GitHub Settings > Actions > Runners | [ ] |
| 2 | Extract Runner | `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(...)` | [ ] |
| 3 | Register Runner | `.\config.cmd --url ... --token ...` | [ ] |
| 4 | Install Service | `.\config.cmd --url ... --token ... --svc --svc-user NT AUTHORITY\SYSTEM` | [ ] |
| 5 | Start Service | `Start-Service -Name "GitHub Actions Runner (*)"` | [ ] |
| 6 | Verify in GitHub | Settings > Actions > Runners > Status = 🟢 Idle | [ ] |
| 7 | Test Workflow | Actions > Dashboard Alerts > Run workflow | [ ] |
| 8 | Configure Secrets | Settings > Secrets and variables > Actions | [ ] |

---

## 🔑 GitHub Secrets Configuration

```
TEAMS_WEBHOOK_URL              (Required for Dashboard Alerts)
CCMA_USERNAME                  (Required for Playwright Tests)
CCMA_PASSWORD                  (Required for Playwright Tests)
TEST_ENVIRONMENT_URL           (Required for Playwright Tests)
SENDGRID_API_KEY              (Optional - for email alerts)
```

**How to add:**
1. GitHub Repo > Settings > Secrets and variables > Actions
2. Click "New repository secret"
3. Enter name and value
4. Click "Add secret"

---

## 🔗 Important Links

| Resource | Link |
|----------|------|
| Setup Guide (Detailed) | `GITHUB_ACTIONS_SETUP.md` |
| Runner Setup (Step-by-Step) | `SELF_HOSTED_RUNNER_SETUP.md` |
| GitHub Actions Documentation | https://docs.github.com/en/actions |
| Self-Hosted Runners Docs | https://docs.github.com/en/actions/hosting-your-own-runners |
| Repository | https://github.com/SaiVikas-Panthangi/NVD |

---

## ⚡ Common Tasks

### **Check Runner Status**
```powershell
Get-Service | Where-Object {$_.Name -like "*GitHubActionsRunner*"} | Select Status, StartType
```

### **View Workflow Logs**
1. Go to: GitHub Repo > Actions
2. Click workflow name
3. Click workflow run
4. Click job name
5. Expand steps to see logs

### **Download Artifacts**
1. Go to: GitHub Repo > Actions
2. Click completed workflow run
3. Scroll to "Artifacts" section
4. Click to download

### **Trigger Manual Workflow**
1. Go to: GitHub Repo > Actions
2. Click workflow name
3. Click "Run workflow" button
4. Select branch/inputs
5. Click "Run workflow"

### **Check Secret Values**
```
⚠️ WARNING: Never print secrets!
Secrets are write-only in GitHub for security.
To verify a secret works: run a workflow and check logs.
```

---

## 🆘 Troubleshooting Quick Links

| Issue | Solution |
|-------|----------|
| **Runner shows "Offline"** | See: SELF_HOSTED_RUNNER_SETUP.md > Troubleshooting > Runner Offline |
| **Workflow stays "Queued"** | See: SELF_HOSTED_RUNNER_SETUP.md > Troubleshooting > Queued |
| **"Cannot connect to GitHub"** | See: SELF_HOSTED_RUNNER_SETUP.md > Troubleshooting > Connection |
| **Permission Denied** | Run PowerShell as Administrator |
| **Service won't start** | See: SELF_HOSTED_RUNNER_SETUP.md > Troubleshooting > Service |

---

## 📊 Workflow Status Badges

Add to your README:

```markdown
[![Dashboard Alerts Monitor](https://github.com/SaiVikas-Panthangi/NVD/actions/workflows/monitor-hourly.yml/badge.svg)](https://github.com/SaiVikas-Panthangi/NVD/actions/workflows/monitor-hourly.yml)
[![Playwright Tests](https://github.com/SaiVikas-Panthangi/NVD/actions/workflows/playwright-tests.yml/badge.svg)](https://github.com/SaiVikas-Panthangi/NVD/actions/workflows/playwright-tests.yml)
```

---

## 🎯 Workflows Overview

### **Dashboard Alerts Hourly Monitor** (`monitor-hourly.yml`)
- **Trigger**: Schedule (09:00-23:00 IST) + Manual
- **Runner**: Self-hosted
- **Secrets**: TEAMS_WEBHOOK_URL
- **Output**: Reports, logs, state JSON files

### **NVD Playwright Tests** (`playwright-tests.yml`)
- **Trigger**: Push/PR + Schedule (Daily 08:00 UTC) + Manual
- **Runner**: Ubuntu latest (cloud-hosted)
- **Secrets**: CCMA_USERNAME, CCMA_PASSWORD, TEST_ENVIRONMENT_URL
- **Output**: Test reports, screenshots, test results

---

## ✅ Success Indicators

**Runner is working correctly when:**
- ✅ Status in GitHub Settings: 🟢 **Idle**
- ✅ Service shows: **Running**
- ✅ Manual workflow triggers immediately
- ✅ Workflow completes with status: ✅ **Passed**
- ✅ Artifacts are available for download
- ✅ Teams notifications received (if Teams webhook configured)

---

## 🔐 Security Best Practices

1. **Never commit secrets to Git**
   - Use GitHub Secrets only
   - Secrets are never printed in logs

2. **Keep runner software updated**
   - GitHub recommends updating runner regularly
   - Check for updates monthly

3. **Limit runner labels**
   - Use specific labels to avoid running sensitive jobs on this runner

4. **Monitor runner access**
   - Check GitHub Settings > Actions > Runners for unexpected runners
   - Remove old/unused runners

5. **Secure the runner machine**
   - Keep Windows updated
   - Use strong passwords for admin accounts
   - Enable Windows Firewall

---

## 📞 Support

For detailed information, see:
1. **`GITHUB_ACTIONS_SETUP.md`** - Complete setup guide
2. **`SELF_HOSTED_RUNNER_SETUP.md`** - Runner installation steps
3. **GitHub Documentation** - https://docs.github.com/en/actions

---

**Last Updated:** 2026-07-14
**Status:** ✅ Ready for deployment
