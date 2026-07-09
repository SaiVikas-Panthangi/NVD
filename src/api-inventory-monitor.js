#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    configPath: path.resolve(__dirname, '..', 'config', 'api-monitor-config.json')
  };

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      args.configPath = path.resolve(argv[++i]);
    }
  }

  return args;
}

function resolvePath(root, value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const root = path.dirname(path.dirname(configPath));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  config.environment = config.environment || 'PROD';
  config.inventory = {
    inventoryPageUrl: '',
    extractMode: 'fetch',
    linkSelector: 'a[href]',
    linkTextIncludes: '',
    urlPattern: '',
    timeoutMs: 30000,
    storageStatePath: '',
    ...config.inventory
  };

  config.staticApis = Array.isArray(config.staticApis) ? config.staticApis : [];

  config.apiCheck = {
    checkMode: 'fetch',
    allowInsecureTls: false,
    concurrency: 6,
    retryOnNetworkError: 1,
    method: 'GET',
    timeoutMs: 8000,
    slowThresholdMs: 5000,
    maxEndpoints: 0,
    successStatusCodes: [200],
    headers: {},
    ...config.apiCheck
  };

  config.notifications = {
    transitionAlertsEnabled: true,
    notifyOnFirstRunDown: true,
    teamsWebhookUrl: '',
    email: {
      enabled: false,
      from: '',
      recipients: [],
      subjectPrefix: '[PROD ALERT]'
    },
    runSummary: {
      enabled: true,
      channels: ['teams'],
      alwaysSend: true,
      onlyWhenDown: true,
      maxItems: 25
    },
    bulkFailureAlert: {
      enabled: true,
      channels: ['teams'],
      minDownCount: 10,
      maxItems: 25,
      repeatMinDownDelta: 5
    },
    ...config.notifications
  };

  config.notifications.email = {
    enabled: false,
    from: '',
    recipients: [],
    subjectPrefix: '[PROD ALERT]',
    ...config.notifications.email
  };

  config.notifications.runSummary = {
    enabled: true,
    channels: ['teams'],
    alwaysSend: true,
    onlyWhenDown: true,
    maxItems: 25,
    ...config.notifications.runSummary
  };

  config.notifications.bulkFailureAlert = {
    enabled: true,
    channels: ['teams'],
    minDownCount: 10,
    maxItems: 25,
    repeatMinDownDelta: 5,
    ...config.notifications.bulkFailureAlert
  };

  config.storage = {
    stateFile: 'data/api-monitor-state.json',
    reportDir: 'reports',
    ...config.storage
  };

  config.execution = {
    failOnDown: false,
    failOnNotificationError: false,
    ...config.execution
  };

  config.storage.stateFile = resolvePath(root, config.storage.stateFile);
  config.storage.reportDir = resolvePath(root, config.storage.reportDir);
  config.inventory.storageStatePath = resolvePath(root, config.inventory.storageStatePath);

  // Allow CI/CD runners to inject webhook securely via environment variable.
  if (process.env.TEAMS_WEBHOOK_URL) {
    config.notifications.teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
  }

  return config;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function textOnly(htmlText) {
  return (htmlText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isMatching(url, pattern) {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, 'i').test(url);
  } catch {
    return url.includes(pattern);
  }
}

function textMatchesFilter(text, filter) {
  if (!filter) return true;
  return String(text || '').toLowerCase().includes(String(filter).toLowerCase());
}

function normalizeName(name, url, index) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (normalizedName && normalizedName !== 'api.test' && normalizedName !== 'api.doc') {
    return name.trim();
  }
  try {
    const parsed = new URL(url);
    const part = parsed.pathname.split('/').filter(Boolean).pop();
    return part || `api-${index + 1}`;
  } catch {
    return `api-${index + 1}`;
  }
}

function dedupeByUrl(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item || !item.url) continue;
    if (!seen.has(item.url)) seen.set(item.url, item);
  }
  return Array.from(seen.values());
}

async function collectFromFetch(config) {
  if (!config.inventory.inventoryPageUrl) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.inventory.timeoutMs);

  try {
    const response = await fetch(config.inventory.inventoryPageUrl, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Inventory page returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gim;
    const out = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const href = match[1];
      const title = textOnly(match[2]);
      let fullUrl;

      try {
        fullUrl = new URL(href, config.inventory.inventoryPageUrl).toString();
      } catch {
        continue;
      }

      if (!/^https?:\/\//i.test(fullUrl)) continue;
      if (!textMatchesFilter(title, config.inventory.linkTextIncludes)) continue;
      if (!isMatching(fullUrl, config.inventory.urlPattern)) continue;

      out.push({
        name: title,
        url: fullUrl,
        source: 'inventory-fetch'
      });
    }

    return out;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectFromPlaywright(config) {
  if (!config.inventory.inventoryPageUrl) return [];

  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    throw new Error('Playwright not installed. Run npm i -D @playwright/test for extractMode="playwright".');
  }

  const browser = await chromium.launch({ headless: true });
  const ctxOptions = {};

  if (config.inventory.storageStatePath) {
    ctxOptions.storageState = config.inventory.storageStatePath;
  }

  const context = await browser.newContext({
    ...ctxOptions,
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  try {
    await page.goto(config.inventory.inventoryPageUrl, {
      waitUntil: 'networkidle',
      timeout: config.inventory.timeoutMs
    });

    const links = await page.$$eval(config.inventory.linkSelector, (anchors) => {
      return anchors.map((a) => ({
        href: a.getAttribute('href') || '',
        text: (a.textContent || '').trim()
      }));
    });

    const out = [];
    for (const link of links) {
      let fullUrl;
      try {
        fullUrl = new URL(link.href, config.inventory.inventoryPageUrl).toString();
      } catch {
        continue;
      }

      if (!/^https?:\/\//i.test(fullUrl)) continue;
      if (!textMatchesFilter(link.text, config.inventory.linkTextIncludes)) continue;
      if (!isMatching(fullUrl, config.inventory.urlPattern)) continue;

      out.push({
        name: link.text,
        url: fullUrl,
        source: 'inventory-playwright'
      });
    }

    return out;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function collectEndpoints(config) {
  const staticApis = config.staticApis
    .filter((x) => x && x.url)
    .map((x) => ({ name: x.name || '', url: x.url, source: 'static-config' }));

  let inventoryApis = [];
  if (config.inventory.inventoryPageUrl) {
    inventoryApis = config.inventory.extractMode === 'playwright'
      ? await collectFromPlaywright(config)
      : await collectFromFetch(config);
  }

  const merged = [...staticApis, ...inventoryApis].map((x, i) => ({
    ...x,
    name: normalizeName(x.name, x.url, i)
  }));

  return dedupeByUrl(merged);
}

async function ping(endpoint, apiCheck) {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiCheck.timeoutMs);

  try {
    const response = await fetch(endpoint.url, {
      method: apiCheck.method,
      headers: apiCheck.headers,
      signal: controller.signal
    });

    const elapsed = Date.now() - start;
    const statusCode = response.status;
    const success = apiCheck.successStatusCodes.includes(statusCode);
    const slow = elapsed > apiCheck.slowThresholdMs;
    const status = success ? 'UP' : 'DOWN';

    return {
      ...endpoint,
      status,
      statusCode,
      responseTimeMs: elapsed,
      reason: success ? (slow ? `SLOW ${elapsed}ms` : 'OK') : `HTTP ${statusCode}`,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    const elapsed = Date.now() - start;
    const reason = error && error.name === 'AbortError'
      ? `TIMEOUT>${apiCheck.timeoutMs}ms`
      : `ERROR: ${error.message}`;

    return {
      ...endpoint,
      status: 'DOWN',
      statusCode: null,
      responseTimeMs: elapsed,
      reason,
      checkedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildPlaywrightContext(config) {
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    throw new Error('Playwright not installed. Run npm i -D @playwright/test.');
  }

  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    ignoreHTTPSErrors: Boolean(config.apiCheck.allowInsecureTls)
  };

  if (config.inventory.storageStatePath) {
    contextOptions.storageState = config.inventory.storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  return { browser, context, page };
}

async function pingWithPlaywright(page, endpoint, apiCheck) {
  const retries = Math.max(0, Number(apiCheck.retryOnNetworkError || 0));
  let attempt = 0;

  while (attempt <= retries) {
    const start = Date.now();
    try {
      const response = await page.goto(endpoint.url, {
        timeout: apiCheck.timeoutMs,
        waitUntil: 'domcontentloaded'
      });

      const elapsed = Date.now() - start;
      const statusCode = response ? response.status() : null;
      const success = statusCode !== null && apiCheck.successStatusCodes.includes(statusCode);
      const slow = elapsed > apiCheck.slowThresholdMs;
      const status = success ? 'UP' : 'DOWN';

      return {
        ...endpoint,
        status,
        statusCode,
        responseTimeMs: elapsed,
        reason: status === 'UP'
          ? (slow ? `SLOW ${elapsed}ms` : 'OK')
          : (statusCode === null ? 'NO_RESPONSE' : `HTTP ${statusCode}`),
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      const elapsed = Date.now() - start;
      const msg = String(error && error.message ? error.message : error);
      const retryable = /ERR_ABORTED|ERR_CONNECTION_CLOSED|Timeout/.test(msg);

      if (retryable && attempt < retries) {
        attempt += 1;
        continue;
      }

      return {
        ...endpoint,
        status: 'DOWN',
        statusCode: null,
        responseTimeMs: elapsed,
        reason: `ERROR: ${msg}`,
        checkedAt: new Date().toISOString()
      };
    }
  }
}

async function runWithConcurrency(items, concurrency, workerFn) {
  const safeConcurrency = Math.max(1, Number(concurrency || 1));
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await workerFn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()));
  return results;
}

async function runPlaywrightChecksInBatches(context, endpoints, apiCheck) {
  const workerCount = Math.min(Math.max(1, Number(apiCheck.concurrency || 1)), endpoints.length);
  const pages = await Promise.all(Array.from({ length: workerCount }, () => context.newPage()));
  const results = new Array(endpoints.length);
  let index = 0;

  async function worker(page) {
    while (true) {
      const current = index;
      index += 1;
      if (current >= endpoints.length) return;

      const endpoint = endpoints[current];
      const result = await pingWithPlaywright(page, endpoint, apiCheck);
      results[current] = result;

      const icon = result.status === 'UP' ? '✅' : '❌';
      console.log(`${icon} ${result.name} | ${result.statusCode || 'N/A'} | ${result.responseTimeMs}ms | ${result.reason} | ${result.url}`);
    }
  }

  try {
    await Promise.all(pages.map((page) => worker(page)));
  } finally {
    await Promise.all(pages.map((p) => p.close()));
  }

  return results;
}

function loadState(filePath) {
  return readJson(filePath, { lastRunAt: null, endpoints: {}, notifications: {} });
}

function summarizeStateEndpoints(state) {
  const values = Object.values((state && state.endpoints) || {});
  const total = values.length;
  const up = values.filter((x) => x.status === 'UP').length;
  const down = values.filter((x) => x.status === 'DOWN').length;
  return { total, up, down };
}

function healthBand(total, down) {
  if (!total || down === 0) return 'ALL_UP';
  const ratio = down / total;
  if (ratio >= 0.5) return 'MAJOR_OUTAGE';
  return 'DEGRADED';
}

function calculateTransitions(results, prevState, notifyOnFirstRunDown) {
  const transitions = [];

  for (const item of results) {
    const prev = prevState.endpoints[item.url] || null;
    const prevStatus = prev ? prev.status : 'UNKNOWN';

    if (prevStatus === 'UP' && item.status === 'DOWN') {
      transitions.push({ type: 'DOWN', prev, current: item });
    }

    if (prevStatus === 'DOWN' && item.status === 'UP') {
      transitions.push({ type: 'RECOVERED', prev, current: item });
    }

    if (!prev && item.status === 'DOWN' && notifyOnFirstRunDown) {
      transitions.push({ type: 'DOWN', prev: null, current: item });
    }
  }

  return transitions;
}

function saveState(filePath, results, prevState) {
  const endpoints = {};

  for (const item of results) {
    const prev = prevState.endpoints[item.url];
    const downSince = item.status === 'DOWN'
      ? (prev && prev.status === 'DOWN' && prev.downSince ? prev.downSince : item.checkedAt)
      : null;

    endpoints[item.url] = {
      name: item.name,
      status: item.status,
      statusCode: item.statusCode,
      responseTimeMs: item.responseTimeMs,
      reason: item.reason,
      checkedAt: item.checkedAt,
      downSince
    };
  }

  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify({
    lastRunAt: new Date().toISOString(),
    endpoints,
    notifications: (prevState && prevState.notifications) || {}
  }, null, 2));
}

function uptimeDuration(startIso, endIso) {
  if (!startIso || !endIso) return 'n/a';
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function buildRunSummary(summary, config) {
  const failed = summary.results
    .filter((item) => item.status === 'DOWN')
    .map((item) => ({
      name: item.name,
      url: item.url,
      statusCode: item.statusCode,
      responseTimeMs: item.responseTimeMs,
      reason: item.reason
    }));

  return {
    checkedAt: summary.checkedAt,
    environment: config.environment,
    total: summary.total,
    up: summary.up,
    down: summary.down,
    averageResponseMs: summary.averageResponseMs,
    failed
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateDashboardHtml(runSummary) {
  const failedRows = runSummary.failed.length
    ? runSummary.failed.map((item) => {
      return `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.statusCode === null ? 'N/A' : item.statusCode)}</td>
        <td>${escapeHtml(item.responseTimeMs)}</td>
        <td>${escapeHtml(item.reason)}</td>
      </tr>`;
    }).join('\n')
    : '<tr><td colspan="4">No failed APIs in this run.</td></tr>';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>API Monitor Dashboard</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; }
    h1 { margin: 0 0 8px 0; }
    .meta { margin-bottom: 16px; color: #4b5563; }
    .cards { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; min-width: 150px; }
    .value { font-size: 20px; font-weight: 700; }
    .down { color: #b91c1c; }
    .up { color: #047857; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 13px; }
    th { background: #f3f4f6; }
  </style>
</head>
<body>
  <h1>API Monitor Dashboard</h1>
  <div class="meta">Environment: ${escapeHtml(runSummary.environment)} | Checked At: ${escapeHtml(runSummary.checkedAt)}</div>
  <div class="cards">
    <div class="card"><div>Total APIs</div><div class="value">${runSummary.total}</div></div>
    <div class="card"><div>UP</div><div class="value up">${runSummary.up}</div></div>
    <div class="card"><div>DOWN</div><div class="value down">${runSummary.down}</div></div>
    <div class="card"><div>Avg Response (ms)</div><div class="value">${runSummary.averageResponseMs}</div></div>
  </div>
  <h2>Failed APIs (Status + Error Response)</h2>
  <table>
    <thead>
      <tr>
        <th>API</th>
        <th>Status</th>
        <th>Response Time (ms)</th>
        <th>Error Reason</th>
      </tr>
    </thead>
    <tbody>
      ${failedRows}
    </tbody>
  </table>
</body>
</html>`;
}

function shouldSendRunSummary(cfg, runSummary, prevSummary) {
  if (cfg.alwaysSend) {
    return { send: true, reason: 'always-send' };
  }

  const hasPrev = prevSummary && prevSummary.total > 0;
  if (!hasPrev) {
    return { send: true, reason: 'first-run' };
  }

  if (cfg.onlyWhenDown && runSummary.down === 0 && prevSummary.down === 0) {
    return { send: false, reason: 'all-up-and-onlyWhenDown' };
  }

  if (runSummary.total !== prevSummary.total) {
    return { send: true, reason: 'endpoint-count-changed' };
  }

  if (runSummary.down === prevSummary.down && runSummary.up === prevSummary.up) {
    return { send: false, reason: 'no-material-change' };
  }

  if (prevSummary.down > 0 && runSummary.down === 0) {
    return { send: true, reason: 'fully-recovered' };
  }

  if (runSummary.down > prevSummary.down) {
    return { send: true, reason: 'worsened' };
  }

  return { send: true, reason: 'improved' };
}

async function sendRunSummaryNotifications(config, runSummary, prevSummary) {
  const cfg = config.notifications.runSummary;
  if (!cfg.enabled) return;
  const decision = shouldSendRunSummary(cfg, runSummary, prevSummary);
  if (!decision.send) {
    console.log(`Run summary skipped: ${decision.reason}`);
    return;
  }

  const configuredMax = Number(cfg.maxItems || 25);
  const maxItems = configuredMax <= 0 ? runSummary.failed.length : Math.max(1, configuredMax);
  const sample = runSummary.failed.slice(0, maxItems);

  const lines = [
    '📊 API RUN SUMMARY',
    `Reason: ${decision.reason}`,
    `Environment: ${runSummary.environment}`,
    `Checked At: ${runSummary.checkedAt}`,
    `Total: ${runSummary.total} | UP: ${runSummary.up} | DOWN: ${runSummary.down} | Avg: ${runSummary.averageResponseMs}ms`
  ];

  if (prevSummary && prevSummary.total > 0) {
    lines.push(`Previous: Total ${prevSummary.total} | UP ${prevSummary.up} | DOWN ${prevSummary.down}`);
  }

  if (sample.length > 0) {
    lines.push('Failed APIs:');
    for (const item of sample) {
      lines.push(`- ${item.name} | ${item.statusCode || 'N/A'} | ${item.reason}`);
    }
  }

  if (runSummary.failed.length > sample.length) {
    lines.push(`...and ${runSummary.failed.length - sample.length} more failures.`);
  }

  const message = lines.join('\n');
  const channels = new Set((cfg.channels || []).map((c) => String(c).toLowerCase()));
  const throwOnNotifyError = Boolean(config.execution && config.execution.failOnNotificationError);

  if (channels.has('teams')) {
    await sendTeams(config.notifications.teamsWebhookUrl, message, { throwOnError: throwOnNotifyError });
  }
}

async function sendBulkFailureAlert(config, runSummary) {
  const cfg = config.notifications.bulkFailureAlert;
  if (!cfg.enabled) return;

  const minDownCount = Math.max(1, Number(cfg.minDownCount || 10));
  if (runSummary.down < minDownCount) return;

  const prevSummary = cfg.__prevSummary || { total: 0, up: 0, down: 0 };
  const repeatDelta = Math.max(1, Number(cfg.repeatMinDownDelta || 5));
  const prevWasBulk = prevSummary.down >= minDownCount;
  const downDelta = Math.abs(runSummary.down - prevSummary.down);

  if (prevWasBulk && downDelta < repeatDelta) {
    console.log(`Bulk alert skipped: change below repeatMinDownDelta (${repeatDelta}).`);
    return;
  }

  const configuredMax = Number(cfg.maxItems || 25);
  const maxItems = configuredMax <= 0 ? runSummary.failed.length : Math.max(1, configuredMax);
  const sample = runSummary.failed.slice(0, maxItems);
  const lines = [
    '🚨 BULK API FAILURE ALERT',
    `Environment: ${runSummary.environment}`,
    `Checked At: ${runSummary.checkedAt}`,
    `Total: ${runSummary.total} | UP: ${runSummary.up} | DOWN: ${runSummary.down}`,
    `Threshold Triggered: DOWN >= ${minDownCount}`
  ];

  lines.push('Failed APIs:');
  for (const item of sample) {
    lines.push(`- ${item.name} | ${item.statusCode || 'N/A'} | ${item.reason}`);
  }

  if (runSummary.failed.length > sample.length) {
    lines.push(`...and ${runSummary.failed.length - sample.length} more failures.`);
  }

  const message = lines.join('\n');
  const channels = new Set((cfg.channels || []).map((c) => String(c).toLowerCase()));
  const throwOnNotifyError = Boolean(config.execution && config.execution.failOnNotificationError);

  if (channels.has('teams')) {
    await sendTeams(config.notifications.teamsWebhookUrl, message, { throwOnError: throwOnNotifyError });
  }
}

async function sendTeams(webhookUrl, message, options = {}) {
  if (!webhookUrl) {
    console.warn('Teams notification skipped: teamsWebhookUrl is empty.');
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });

    if (!response.ok) {
      const rawBody = await response.text();
      let errorCode = '';
      let errorMessage = '';
      try {
        const parsed = JSON.parse(rawBody);
        errorCode = parsed && parsed.error && parsed.error.code ? String(parsed.error.code) : '';
        errorMessage = parsed && parsed.error && parsed.error.message ? String(parsed.error.message) : '';
      } catch {
        errorMessage = rawBody || '';
      }

      const details = [
        `Teams webhook failed with ${response.status}`,
        errorCode ? `code=${errorCode}` : '',
        errorMessage ? `message=${errorMessage}` : ''
      ].filter(Boolean).join(' | ');

      const error = new Error(details);
      if (options.throwOnError) {
        throw error;
      }

      console.warn(`Teams notification warning: ${error.message}`);
      if (errorCode === 'DirectApiAuthorizationRequired') {
        console.warn('Teams notification hint: this Power Automate URL requires OAuth. Use an anonymous HTTP trigger URL (with signature query params) or add bearer token auth.');
      }
      return false;
    }

    return true;
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }

    console.warn(`Teams notification warning: ${error.message}`);
    return false;
  }
}

async function notifyTransitions(config, transitions, prevState) {
  const throwOnNotifyError = Boolean(config.execution && config.execution.failOnNotificationError);

  for (const t of transitions) {
    if (t.type === 'DOWN') {
      const msg = [
        '🔴 API DOWN',
        `Environment: ${config.environment}`,
        `API: ${t.current.name}`,
        `URL: ${t.current.url}`,
        `Status: ${t.current.statusCode || 'N/A'}`,
        `Response: ${t.current.responseTimeMs}ms`,
        `Reason: ${t.current.reason}`,
        `Time: ${t.current.checkedAt}`
      ].join('\n');

      await sendTeams(config.notifications.teamsWebhookUrl, msg, { throwOnError: throwOnNotifyError });
    }

    if (t.type === 'RECOVERED') {
      const old = prevState.endpoints[t.current.url] || {};
      const msg = [
        '🟢 API RECOVERED',
        `Environment: ${config.environment}`,
        `API: ${t.current.name}`,
        `URL: ${t.current.url}`,
        `Recovered At: ${t.current.checkedAt}`,
        `Downtime: ${uptimeDuration(old.downSince, t.current.checkedAt)}`,
        `Status: ${t.current.statusCode}`,
        `Response: ${t.current.responseTimeMs}ms`
      ].join('\n');

      await sendTeams(config.notifications.teamsWebhookUrl, msg, { throwOnError: throwOnNotifyError });
    }
  }
}

function writeReports(results, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });

  const now = new Date();
  const summary = {
    checkedAt: now.toISOString(),
    total: results.length,
    up: results.filter((x) => x.status === 'UP').length,
    down: results.filter((x) => x.status === 'DOWN').length,
    averageResponseMs: results.length
      ? Math.round(results.reduce((a, b) => a + b.responseTimeMs, 0) / results.length)
      : 0,
    results
  };

  fs.writeFileSync(path.join(reportDir, 'api-monitor-last-run.json'), JSON.stringify(summary, null, 2));

  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const csv = path.join(reportDir, `api-monitor-history-${day}.csv`);
  const header = 'timestamp,api_name,url,status,status_code,response_time_ms,reason\n';

  if (!fs.existsSync(csv)) {
    fs.writeFileSync(csv, header);
  }

  const lines = results.map((x) => {
    const cols = [
      x.checkedAt,
      x.name,
      x.url,
      x.status,
      x.statusCode === null ? '' : x.statusCode,
      x.responseTimeMs,
      String(x.reason).replace(/,/g, ';')
    ];
    return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  fs.appendFileSync(csv, `${lines.join('\n')}\n`);

  const failedOnly = summary.results.filter((x) => x.status === 'DOWN');
  const failedCsv = path.join(reportDir, 'api-monitor-errors-last-run.csv');
  const failedHeader = 'timestamp,api_name,url,status,status_code,response_time_ms,error_reason\n';
  const failedLines = failedOnly.map((x) => {
    const cols = [
      x.checkedAt,
      x.name,
      x.url,
      x.status,
      x.statusCode === null ? '' : x.statusCode,
      x.responseTimeMs,
      String(x.reason).replace(/,/g, ';')
    ];
    return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  fs.writeFileSync(failedCsv, failedHeader + (failedLines.length ? `${failedLines.join('\n')}\n` : ''));

  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.configPath);

  if (config.apiCheck.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  console.log(`Using config: ${args.configPath}`);

  let endpoints = await collectEndpoints(config);
  if (config.apiCheck.maxEndpoints > 0) {
    endpoints = endpoints.slice(0, config.apiCheck.maxEndpoints);
  }

  if (!endpoints.length) {
    throw new Error('No endpoints found. Fill inventory.inventoryPageUrl or staticApis urls.');
  }

  console.log(`Checking ${endpoints.length} endpoints...`);

  const results = [];
  if (config.apiCheck.checkMode === 'playwright') {
    const { browser, context } = await buildPlaywrightContext(config);
    try {
      const rawResults = await runPlaywrightChecksInBatches(context, endpoints, config.apiCheck);

      results.push(...rawResults);
    } finally {
      await context.close();
      await browser.close();
    }
  } else {
    const rawResults = await runWithConcurrency(endpoints, config.apiCheck.concurrency, async (endpoint) => {
      const result = await ping(endpoint, config.apiCheck);
      const icon = result.status === 'UP' ? '✅' : '❌';
      console.log(`${icon} ${result.name} | ${result.statusCode || 'N/A'} | ${result.responseTimeMs}ms | ${result.reason} | ${result.url}`);
      return result;
    });
    results.push(...rawResults);
  }

  const prevState = loadState(config.storage.stateFile);
  const prevSummary = summarizeStateEndpoints(prevState);
  const transitions = calculateTransitions(results, prevState, config.notifications.notifyOnFirstRunDown);

  if (config.notifications.transitionAlertsEnabled) {
    await notifyTransitions(config, transitions, prevState);
  }
  saveState(config.storage.stateFile, results, prevState);

  const summary = writeReports(results, config.storage.reportDir);
  const runSummary = buildRunSummary(summary, config);

  fs.writeFileSync(
    path.join(config.storage.reportDir, 'api-monitor-dashboard.json'),
    JSON.stringify(runSummary, null, 2)
  );

  fs.writeFileSync(
    path.join(config.storage.reportDir, 'api-monitor-dashboard.html'),
    generateDashboardHtml(runSummary)
  );

  config.notifications.bulkFailureAlert.__prevSummary = prevSummary;
  await sendRunSummaryNotifications(config, runSummary, prevSummary);
  await sendBulkFailureAlert(config, runSummary);

  console.log('---');
  console.log(`Total: ${summary.total} | UP: ${summary.up} | DOWN: ${summary.down} | Avg: ${summary.averageResponseMs}ms`);
  console.log(`Alerts sent for transitions: ${transitions.length}`);

  if (summary.down > 0 && config.execution.failOnDown) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`Monitor failed: ${error.message}`);
  process.exit(1);
});
