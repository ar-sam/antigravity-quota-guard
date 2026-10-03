/**
 * Antigravity Quota Guard — Timezone Manager & Presentation Formatter
 * Implements R14 from architecture specification.
 *
 * Strict Invariant: Display timezone MUST NOT affect core logic (quota calculations,
 * reset-time comparisons, grace timers, state machine transitions). All logic is UTC.
 * Timezone only affects UI rendering. Persian UI (fa) does NOT force Asia/Tehran.
 */

'use strict';

const EventEmitter = require('events');

/**
 * Maps ASCII digits 0-9 to Persian digits \u06F0-\u06F9.
 * @param {string|number} input
 * @returns {string}
 */
function toPersianDigits(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return str.replace(/[0-9]/g, w => persianDigits[+w]);
}

/**
 * Resolves the effective presentation timezone.
 * @param {object} [config]
 * @returns {string} Canonical IANA timezone identifier
 */
function resolveEffectiveTimeZone(config = {}) {
  const mode = config.display?.timeZoneMode || 'system';
  const fixed = config.display?.fixedTimeZone;

  if (mode === 'fixed' && fixed && typeof fixed === 'string' && fixed.trim().length > 0) {
    try {
      // Validate valid IANA string
      Intl.DateTimeFormat(undefined, { timeZone: fixed.trim() });
      return fixed.trim();
    } catch {
      // Invalid fixed time zone; fallback to system
    }
  }

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Formats compact relative time for titlebar badge.
 * Examples: '2h 14m' or '۲ساعت و ۱۴دقیقه'
 * @param {Date|number|string} targetDate
 * @param {string} [locale='fa']
 * @param {number} [nowEpoch=Date.now()]
 * @returns {string}
 */
function formatRelativeResetTime(targetDate, locale = 'fa', nowEpoch = Date.now()) {
  if (!targetDate) return '--';

  const targetEpoch = targetDate instanceof Date
    ? targetDate.getTime()
    : typeof targetDate === 'number'
      ? targetDate
      : new Date(targetDate).getTime();

  if (Number.isNaN(targetEpoch)) return '--';

  const diffMs = targetEpoch - nowEpoch;
  if (diffMs <= 0) {
    return locale === 'fa' ? 'اکنون' : 'now';
  }

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (locale === 'fa') {
    if (hours > 0 && minutes > 0) {
      return `${toPersianDigits(hours)}ساعت و ${toPersianDigits(minutes)}دقیقه`;
    } else if (hours > 0) {
      return `${toPersianDigits(hours)}ساعت`;
    } else {
      return `${toPersianDigits(Math.max(1, minutes))}دقیقه`;
    }
  }

  // English formatting
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${Math.max(1, minutes)}m`;
  }
}

/**
 * Formats detailed local clock time for panel and tooltips.
 * Example: 'امروز ساعت ۱۷:۴۳ به وقت محلی (America/New_York)'
 * @param {Date|number|string} targetDate
 * @param {string} [timeZone='UTC']
 * @param {string} [locale='fa']
 * @returns {string}
 */
function formatLocalClockTime(targetDate, timeZone = 'UTC', locale = 'fa') {
  if (!targetDate) return '--';

  const dateObj = targetDate instanceof Date
    ? targetDate
    : typeof targetDate === 'number'
      ? new Date(targetDate)
      : new Date(targetDate);

  if (Number.isNaN(dateObj.getTime())) return '--';

  try {
    const timeFormatter = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: locale !== 'fa'
    });

    const timeStr = timeFormatter.format(dateObj);

    if (locale === 'fa') {
      return `ساعت ${timeStr} به وقت محلی (${timeZone})`;
    }

    return `${timeStr} local time (${timeZone})`;
  } catch {
    return dateObj.toISOString();
  }
}

class TimezoneManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this._config = config;
    this._currentTimeZone = resolveEffectiveTimeZone(config);
  }

  getTimeZone() {
    return this._currentTimeZone;
  }

  /**
   * Updates configuration and checks for timezone shifts.
   * @param {object} newConfig
   */
  updateConfig(newConfig) {
    this._config = newConfig;
    this.refreshTimeZone();
  }

  /**
   * Checks runtime system timezone and emits DISPLAY_TIMEZONE_CHANGED if modified.
   * @returns {boolean} Whether timezone changed
   */
  refreshTimeZone() {
    const newTz = resolveEffectiveTimeZone(this._config);
    if (newTz !== this._currentTimeZone) {
      const prevTz = this._currentTimeZone;
      this._currentTimeZone = newTz;
      this.emit('DISPLAY_TIMEZONE_CHANGED', { previous: prevTz, current: newTz });
      return true;
    }
    return false;
  }

  formatRelative(targetDate, locale = 'fa') {
    return formatRelativeResetTime(targetDate, locale);
  }

  formatClock(targetDate, locale = 'fa') {
    return formatLocalClockTime(targetDate, this._currentTimeZone, locale);
  }
}

module.exports = {
  TimezoneManager,
  toPersianDigits,
  resolveEffectiveTimeZone,
  formatRelativeResetTime,
  formatLocalClockTime
};
