# Dashboard Alerts API Monitor

This folder contains a standalone monitor that:
- Reads API URLs from your inventory page and/or static API list.
- Calls each API and checks status code + response time.
- Sends alert notifications only on state transitions (UP -> DOWN, DOWN -> UP).
- Writes run summary and CSV history for reporting.

## Required Fields to Fill

Update `config/api-monitor-config.json`:

1. `inventory.inventoryPageUrl`
- Set the inventory page URL if you want auto extraction of links.

2. `inventory.extractMode`
- `fetch`: for public HTML inventory pages.
- `playwright`: for authenticated/dynamic inventory pages.

3. `inventory.urlPattern`
- Regex filter to keep only API URLs from inventory links.
- Example: `/api/|apigee|nvd`

4. `staticApis[].url`
- Add known API URLs directly (recommended for initial setup).

5. `notifications.teamsWebhookUrl`
- Teams Incoming Webhook URL.

6. `notifications.email`
- `enabled`: true/false
- `from`: verified sender in SendGrid
- `recipients`: list of alert recipients
- Also set environment variable: `SENDGRID_API_KEY`

7. `apiCheck`
- `timeoutMs`, `slowThresholdMs`, `successStatusCodes`, optional headers.

## Run

```bash
npm install
npm run monitor:run
```

## Outputs

- `data/api-monitor-state.json`: state tracking for no-spam alerts.
- `reports/api-monitor-last-run.json`: latest run summary.
- `reports/api-monitor-history-YYYY-MM-DD.csv`: daily historical checks.
