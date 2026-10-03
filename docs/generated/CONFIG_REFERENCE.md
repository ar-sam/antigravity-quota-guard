# Configuration Reference — Antigravity Quota Guard V2.2

> **Dynamic Configuration Invariant:** `DEFAULT VALUE ≠ HARDCODED BEHAVIOR`.
> All thresholds, scopes, and options are runtime configurable via Settings or CLI.

## Thresholds (`config.thresholds`)

| Key | Default | Description | Invariant |
| :--- | :---: | :--- | :--- |
| `warnPercent` | 20% | Advisory UI alert trigger | `warn > stabilize` |
| `stabilizePercent` | 15% | Pre-staging stabilize tier | `stabilize > checkpoint` |
| `checkpointPercent` | 13% | Silent background snapshot creation | `checkpoint > stop` |
| `stopPercent` | 12% | Turn boundary model loop halt | `stop >= 5` |
| `minResumePercent` | 30% | Minimum verified quota required to resume | `minResume > stop` |

## Full Default Configuration JSON

```json
{
  "version": "2.2.0",
  "language": "fa",
  "thresholds": {
    "warnPercent": 20,
    "stabilizePercent": 15,
    "checkpointPercent": 13,
    "stopPercent": 12,
    "minResumePercent": 70
  },
  "durations": {
    "staleGraceSeconds": 60,
    "refreshIntervalSeconds": 180
  },
  "visuals": {
    "hudScope": "fiveHour",
    "displayMode": "standard",
    "badgeStyle": "detailed",
    "themePreset": "clinical",
    "colors": {
      "safe": "#10b981",
      "warn": "#d97706",
      "critical": "#e11d48",
      "text": "#f8fafc",
      "background": "#0f172a"
    }
  },
  "display": {
    "timeZoneMode": "system",
    "fixedTimeZone": null,
    "badgeTimeFormat": "relative"
  },
  "notifications": {
    "enabled": true,
    "soundEnabled": true,
    "soundName": "Glass",
    "desktopNotification": true
  },
  "snapshot": {
    "enabled": true,
    "includeTranscript": true,
    "transcriptMessageLimit": 5,
    "transcriptCharLimitPerMessage": 2000,
    "includeAccountEmail": false,
    "includeArtifactInventory": true,
    "retentionCount": 10
  },
  "handover": {
    "autoOpenAccountFlow": true,
    "autoDetectAccountChange": true,
    "autoVerifyQuota": true,
    "autoPrepareRecovery": true,
    "resumeMode": "automatic_when_supported"
  },
  "expert": {
    "mode": "standard",
    "godModeLifetime": "persistent"
  },
  "auth": {
    "automationMode": "assisted",
    "allowExperimentalUiAutomation": false
  },
  "quota": {
    "providerMode": "auto_safe",
    "allowPrivateRpcFallback": false,
    "allowPrivateProviderDiscovery": false
  },
  "diagnostics": {
    "allowInternalAuthStateInspection": false,
    "showRawQuotaPayload": false,
    "showProviderResolution": false,
    "showSessionMetadata": false
  },
  "scanning": {
    "maxDepth": 4,
    "maxFiles": 50,
    "maxTotalBytes": 52428800,
    "timeoutMs": 3000
  },
  "resume": {
    "requireFreshQuota": true,
    "requireAccountChangeOrReset": true,
    "allowManualSameAccountResume": true
  },
  "simulation": {
    "enabled": false
  },
  "shadowMode": {
    "enabled": false
  },
  "securityInvariants": {
    "DISTINCT_QUOTA_TYPING": {
      "id": "SEC-01",
      "description": "Distinct 0 / null / 100 quota typing: 0% is valid and critical, null is unknown, neither defaults to 100%",
      "enforced": true
    },
    "POSIX_FILE_PERMISSIONS": {
      "id": "SEC-02",
      "directoryMode": 448,
      "fileMode": 384,
      "description": "Config and checkpoints written atomically with fsync and restricted 0700/0600 POSIX permissions",
      "enforced": true
    },
    "RENDERER_WRITE_AUTHORITY": {
      "id": "SEC-03",
      "description": "Renderer process has zero direct filesystem, process execution, or network write authority",
      "authority": "NEVER",
      "enforced": true
    },
    "MONOTONIC_THRESHOLDS": {
      "id": "SEC-04",
      "description": "Threshold order invariant: warnPercent > stabilizePercent > checkpointPercent > stopPercent, and minResumePercent > stopPercent",
      "enforced": true
    },
    "CREDENTIAL_SECRET_EXFILTRATION": {
      "id": "SEC-05",
      "description": "Never extract, transmit, or exfiltrate account tokens, passwords, cookies, or secrets to external networks",
      "policy": "NEVER",
      "enforced": true
    },
    "CREDENTIAL_SECRET_LOGGING": {
      "id": "SEC-06",
      "description": "Never log raw passwords, OAuth bearer tokens, session cookies, or API keys to disk, stdout, or journals",
      "policy": "NEVER",
      "enforced": true
    },
    "CREDENTIAL_SECRET_DISPLAY": {
      "id": "SEC-07",
      "description": "Never display raw secret keys, OAuth tokens, or unmasked credentials in UI, HUD, or recovery documents",
      "policy": "NEVER",
      "enforced": true
    },
    "SESSION_TOKEN_REPLAY": {
      "id": "SEC-08",
      "description": "Never duplicate or replay captured session tokens across processes, machines, or remote instances",
      "policy": "NEVER",
      "enforced": true
    },
    "CROSS_USER_CREDENTIAL_ACCESS": {
      "id": "SEC-09",
      "description": "Never access or inspect keyrings, keychains, or credential stores belonging to other OS users",
      "policy": "NEVER",
      "enforced": true
    },
    "DISPLAY_TIMEZONE_AFFECTS_LOGIC": {
      "id": "SEC-10",
      "description": "Display timezone formatting has zero influence on core quota calculations, timers, state transitions, or reset epochs",
      "policy": "NEVER",
      "enforced": true
    },
    "CREDENTIAL_STORE_MUTATION_CONSENT": {
      "id": "SEC-11",
      "description": "Never manipulate or mutate OS Keychains or secure vaults without explicit, verified user authorization",
      "policy": "ALWAYS",
      "enforced": true
    }
  }
}
```
