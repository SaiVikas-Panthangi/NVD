'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseArgs,
  loadConfig,
  textOnly,
  isMatching,
  textMatchesFilter,
  normalizeName,
  dedupeByUrl,
  healthBand,
  summarizeStateEndpoints,
  calculateTransitions,
  uptimeDuration,
  escapeHtml,
  shouldSendRunSummary,
  buildRunSummary
} = require('./api-inventory-monitor');

describe('parseArgs', () => {
  it('uses default config path when no --config flag is given', () => {
    const args = parseArgs(['node', 'script.js']);
    assert.ok(args.configPath.endsWith('api-monitor-config.json'), `Unexpected path: ${args.configPath}`);
  });

  it('resolves --config flag to an absolute path', () => {
    const args = parseArgs(['node', 'script.js', '--config', '/tmp/my-config.json']);
    assert.equal(args.configPath, '/tmp/my-config.json');
  });

  it('ignores --config flag with no following value', () => {
    const defaultArgs = parseArgs(['node', 'script.js']);
    const args = parseArgs(['node', 'script.js', '--config']);
    assert.equal(args.configPath, defaultArgs.configPath);
  });
});

describe('loadConfig', () => {
  let tmpDir;
  let configPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvd-test-'));
    configPath = path.join(tmpDir, 'config', 'test-config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when config file does not exist', () => {
    assert.throws(
      () => loadConfig('/nonexistent/path/config.json'),
      /Config file not found/
    );
  });

  it('loads and applies defaults from a minimal config file', () => {
    fs.writeFileSync(configPath, JSON.stringify({ staticApis: [] }));
    const config = loadConfig(configPath);
    assert.equal(config.environment, 'PROD');
    assert.equal(config.inventory.extractMode, 'fetch');
    assert.equal(config.apiCheck.concurrency, 6);
    assert.equal(config.notifications.transitionAlertsEnabled, true);
    assert.equal(config.execution.failOnDown, false);
  });

  it('preserves custom values from the config file', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      environment: 'staging',
      staticApis: [{ name: 'MyAPI', url: 'https://example.com/api' }],
      apiCheck: { timeoutMs: 5000 }
    }));
    const config = loadConfig(configPath);
    assert.equal(config.environment, 'staging');
    assert.equal(config.staticApis.length, 1);
    assert.equal(config.apiCheck.timeoutMs, 5000);
    assert.equal(config.apiCheck.concurrency, 6);
  });

  it('overrides teamsWebhookUrl from TEAMS_WEBHOOK_URL env variable', () => {
    fs.writeFileSync(configPath, JSON.stringify({}));
    const original = process.env.TEAMS_WEBHOOK_URL;
    process.env.TEAMS_WEBHOOK_URL = 'https://hooks.example.com/webhook';
    try {
      const config = loadConfig(configPath);
      assert.equal(config.notifications.teamsWebhookUrl, 'https://hooks.example.com/webhook');
    } finally {
      if (original === undefined) {
        delete process.env.TEAMS_WEBHOOK_URL;
      } else {
        process.env.TEAMS_WEBHOOK_URL = original;
      }
    }
  });
});

describe('buildRunSummary', () => {
  const config = { environment: 'staging' };

  it('extracts failed APIs from results', () => {
    const summary = {
      checkedAt: '2024-01-01T00:00:00Z',
      total: 3,
      up: 2,
      down: 1,
      averageResponseMs: 120,
      results: [
        { name: 'API-A', url: 'https://a.com', status: 'UP', statusCode: 200, responseTimeMs: 100, reason: 'OK' },
        { name: 'API-B', url: 'https://b.com', status: 'DOWN', statusCode: 503, responseTimeMs: 200, reason: 'HTTP 503' },
        { name: 'API-C', url: 'https://c.com', status: 'UP', statusCode: 200, responseTimeMs: 60, reason: 'OK' }
      ]
    };
    const result = buildRunSummary(summary, config);
    assert.equal(result.environment, 'staging');
    assert.equal(result.total, 3);
    assert.equal(result.up, 2);
    assert.equal(result.down, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].name, 'API-B');
    assert.equal(result.failed[0].url, 'https://b.com');
    assert.equal(result.failed[0].statusCode, 503);
    assert.equal(result.failed[0].reason, 'HTTP 503');
  });

  it('returns empty failed array when all APIs are up', () => {
    const summary = {
      checkedAt: '2024-01-01T00:00:00Z',
      total: 2,
      up: 2,
      down: 0,
      averageResponseMs: 80,
      results: [
        { name: 'API-A', url: 'https://a.com', status: 'UP', statusCode: 200, responseTimeMs: 80, reason: 'OK' },
        { name: 'API-B', url: 'https://b.com', status: 'UP', statusCode: 200, responseTimeMs: 80, reason: 'OK' }
      ]
    };
    const result = buildRunSummary(summary, config);
    assert.equal(result.failed.length, 0);
  });
});

describe('textOnly', () => {
  it('strips HTML tags', () => {
    assert.equal(textOnly('<b>Hello</b> <i>World</i>'), 'Hello World');
  });

  it('collapses whitespace', () => {
    assert.equal(textOnly('foo   bar'), 'foo bar');
  });

  it('handles null and undefined', () => {
    assert.equal(textOnly(null), '');
    assert.equal(textOnly(undefined), '');
  });

  it('handles plain text', () => {
    assert.equal(textOnly('plain text'), 'plain text');
  });
});

describe('isMatching', () => {
  it('returns true when no pattern is given', () => {
    assert.equal(isMatching('https://example.com/api', ''), true);
    assert.equal(isMatching('https://example.com/api', null), true);
  });

  it('matches using regex', () => {
    assert.equal(isMatching('https://example.com/api/v1', '/api/'), true);
    assert.equal(isMatching('https://example.com/home', '/api/'), false);
  });

  it('falls back to string includes on invalid regex', () => {
    assert.equal(isMatching('https://example.com/api[v1]', '[v1]'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isMatching('https://example.com/API/v1', '/api/'), true);
  });
});

describe('textMatchesFilter', () => {
  it('returns true when filter is empty', () => {
    assert.equal(textMatchesFilter('anything', ''), true);
    assert.equal(textMatchesFilter('anything', null), true);
  });

  it('matches substring case-insensitively', () => {
    assert.equal(textMatchesFilter('Inventory API', 'inventory'), true);
    assert.equal(textMatchesFilter('Inventory API', 'INVENTORY'), true);
  });

  it('returns false when not matching', () => {
    assert.equal(textMatchesFilter('Home Page', 'inventory'), false);
  });
});

describe('normalizeName', () => {
  it('returns trimmed name when valid', () => {
    assert.equal(normalizeName('  My API  ', 'https://example.com/api', 0), 'My API');
  });

  it('falls back to URL path segment for api.test', () => {
    assert.equal(normalizeName('api.test', 'https://example.com/inventory', 0), 'inventory');
  });

  it('falls back to api-N for empty name and invalid URL', () => {
    assert.equal(normalizeName('', 'not-a-url', 2), 'api-3');
  });

  it('falls back to api-N when URL has no path segment', () => {
    assert.equal(normalizeName('', 'https://example.com/', 4), 'api-5');
  });
});

describe('dedupeByUrl', () => {
  it('removes duplicate URLs', () => {
    const input = [
      { url: 'https://a.com', name: 'A' },
      { url: 'https://b.com', name: 'B' },
      { url: 'https://a.com', name: 'A-duplicate' }
    ];
    const result = dedupeByUrl(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'A');
    assert.equal(result[1].name, 'B');
  });

  it('skips items without a url', () => {
    const input = [
      { name: 'No URL' },
      { url: 'https://b.com', name: 'B' }
    ];
    const result = dedupeByUrl(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'B');
  });

  it('handles empty array', () => {
    assert.deepEqual(dedupeByUrl([]), []);
  });
});

describe('healthBand', () => {
  it('returns ALL_UP when no endpoints are down', () => {
    assert.equal(healthBand(10, 0), 'ALL_UP');
  });

  it('returns ALL_UP when total is 0', () => {
    assert.equal(healthBand(0, 0), 'ALL_UP');
  });

  it('returns MAJOR_OUTAGE when 50% or more are down', () => {
    assert.equal(healthBand(10, 5), 'MAJOR_OUTAGE');
    assert.equal(healthBand(10, 8), 'MAJOR_OUTAGE');
  });

  it('returns DEGRADED when fewer than 50% are down', () => {
    assert.equal(healthBand(10, 3), 'DEGRADED');
  });
});

describe('summarizeStateEndpoints', () => {
  it('returns totals from state', () => {
    const state = {
      endpoints: {
        'https://a.com': { status: 'UP' },
        'https://b.com': { status: 'DOWN' },
        'https://c.com': { status: 'UP' }
      }
    };
    const result = summarizeStateEndpoints(state);
    assert.equal(result.total, 3);
    assert.equal(result.up, 2);
    assert.equal(result.down, 1);
  });

  it('handles empty or missing state', () => {
    assert.deepEqual(summarizeStateEndpoints({}), { total: 0, up: 0, down: 0 });
    assert.deepEqual(summarizeStateEndpoints(null), { total: 0, up: 0, down: 0 });
  });
});

describe('calculateTransitions', () => {
  it('detects DOWN transition', () => {
    const results = [{ url: 'https://a.com', name: 'A', status: 'DOWN' }];
    const prevState = { endpoints: { 'https://a.com': { status: 'UP' } } };
    const transitions = calculateTransitions(results, prevState, false);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].type, 'DOWN');
  });

  it('detects RECOVERED transition', () => {
    const results = [{ url: 'https://a.com', name: 'A', status: 'UP' }];
    const prevState = { endpoints: { 'https://a.com': { status: 'DOWN' } } };
    const transitions = calculateTransitions(results, prevState, false);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].type, 'RECOVERED');
  });

  it('fires DOWN on first run when notifyOnFirstRunDown is true', () => {
    const results = [{ url: 'https://a.com', name: 'A', status: 'DOWN' }];
    const prevState = { endpoints: {} };
    const transitions = calculateTransitions(results, prevState, true);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].type, 'DOWN');
  });

  it('does not fire on first run when notifyOnFirstRunDown is false', () => {
    const results = [{ url: 'https://a.com', name: 'A', status: 'DOWN' }];
    const prevState = { endpoints: {} };
    const transitions = calculateTransitions(results, prevState, false);
    assert.equal(transitions.length, 0);
  });
});

describe('uptimeDuration', () => {
  it('returns n/a for missing inputs', () => {
    assert.equal(uptimeDuration(null, null), 'n/a');
    assert.equal(uptimeDuration('', '2024-01-01T00:00:00Z'), 'n/a');
  });

  it('formats duration correctly', () => {
    const start = '2024-01-01T00:00:00.000Z';
    const end = '2024-01-01T00:02:30.000Z';
    assert.equal(uptimeDuration(start, end), '2m 30s');
  });

  it('returns 0m 0s for same timestamps', () => {
    const ts = '2024-01-01T00:00:00.000Z';
    assert.equal(uptimeDuration(ts, ts), '0m 0s');
  });
});

describe('escapeHtml', () => {
  it('escapes special HTML characters', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(escapeHtml("it's & done"), 'it&#39;s &amp; done');
  });

  it('leaves safe strings unchanged', () => {
    assert.equal(escapeHtml('Hello World'), 'Hello World');
  });
});

describe('shouldSendRunSummary', () => {
  const makeRunSummary = (total, up, down) => ({ total, up, down });
  const makePrev = (total, up, down) => ({ total, up, down });

  it('returns send=true when alwaysSend is true', () => {
    const cfg = { alwaysSend: true, onlyWhenDown: false };
    const result = shouldSendRunSummary(cfg, makeRunSummary(5, 5, 0), makePrev(5, 5, 0));
    assert.equal(result.send, true);
    assert.equal(result.reason, 'always-send');
  });

  it('returns send=true on first run (no previous)', () => {
    const cfg = { alwaysSend: false, onlyWhenDown: false };
    const result = shouldSendRunSummary(cfg, makeRunSummary(5, 5, 0), null);
    assert.equal(result.send, true);
    assert.equal(result.reason, 'first-run');
  });

  it('skips when onlyWhenDown and everything is up', () => {
    const cfg = { alwaysSend: false, onlyWhenDown: true };
    const result = shouldSendRunSummary(cfg, makeRunSummary(5, 5, 0), makePrev(5, 5, 0));
    assert.equal(result.send, false);
    assert.equal(result.reason, 'all-up-and-onlyWhenDown');
  });

  it('sends when count changes', () => {
    const cfg = { alwaysSend: false, onlyWhenDown: false };
    const result = shouldSendRunSummary(cfg, makeRunSummary(6, 6, 0), makePrev(5, 5, 0));
    assert.equal(result.send, true);
    assert.equal(result.reason, 'endpoint-count-changed');
  });

  it('skips when no material change', () => {
    const cfg = { alwaysSend: false, onlyWhenDown: false };
    const result = shouldSendRunSummary(cfg, makeRunSummary(5, 3, 2), makePrev(5, 3, 2));
    assert.equal(result.send, false);
    assert.equal(result.reason, 'no-material-change');
  });

  it('sends when fully recovered', () => {
    const cfg = { alwaysSend: false, onlyWhenDown: false };
    const result = shouldSendRunSummary(cfg, makeRunSummary(5, 5, 0), makePrev(5, 3, 2));
    assert.equal(result.send, true);
    assert.equal(result.reason, 'fully-recovered');
  });

  it('sends when situation worsened', () => {
    const cfg = { alwaysSend: false, onlyWhenDown: false };
    const result = shouldSendRunSummary(cfg, makeRunSummary(5, 2, 3), makePrev(5, 4, 1));
    assert.equal(result.send, true);
    assert.equal(result.reason, 'worsened');
  });
});

