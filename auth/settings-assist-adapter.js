/**
 * Antigravity Quota Guard — Settings Assistance Adapter
 * Implements R11 and R13 from architecture specification.
 *
 * Invariant: Never describes reverse-engineered UI routes as official API.
 * The documented user-facing Antigravity Settings path is official (SETTINGS_PATH_DOCUMENTED).
 * Programmatic dispatch is classified as REVERSE_ENGINEERED.
 */

'use strict';

const isMac = process.platform === 'darwin';
const SETTINGS_SHORTCUT = isMac ? '⌘,' : 'Ctrl+,';

/**
 * Returns documented settings guidance steps for the user.
 * @param {string} [locale='fa'] - 'fa' | 'en'
 * @returns {object}
 */
function getSettingsGuidance(locale = 'fa') {
  if (locale === 'fa') {
    return {
      title: 'راهنمای رسمی تغییر حساب کاربری در Antigravity',
      shortcut: SETTINGS_SHORTCUT,
      steps: [
        `۱. باز کردن بخش تنظیمات با کلید میانبر ${SETTINGS_SHORTCUT} یا از منوی اصلی برنامه.`,
        '۲. انتخاب بخش «حساب‌های کاربری» (Accounts) از فهرست سمت چپ تنظیمات.',
        '۳. خروج از حساب فعلی یا اتصال حساب دوم دارای سهمیه فعال.',
        '۴. بازگشت به این پنجره و فشردن دکمه «ادامه کار با حساب جدید» (Resume).'
      ],
      notice: 'مسیر فوق تنها مسیر رسمی و ایمن برای تغییر حساب کاربری در نسخه دسکتاپ است.'
    };
  }

  return {
    title: 'Official Antigravity Account Switch Guide',
    shortcut: SETTINGS_SHORTCUT,
    steps: [
      `1. Open Settings using the keyboard shortcut ${SETTINGS_SHORTCUT} or via the application menu.`,
      '2. Navigate to the "Accounts" section from the left navigation panel.',
      '3. Sign out of the exhausted account or switch to a secondary account with available quota.',
      '4. Return to this panel and click "Resume Work with New Account".'
    ],
    notice: 'The above workflow is the official, safe method for switching accounts in Antigravity Desktop.'
  };
}

/**
 * Prepares the assisted navigation payload for IPC dispatch.
 * Clarifies provenance: programmatic dispatch is reverse-engineered assistance.
 * @param {object} [options]
 * @returns {object}
 */
function getAssistedNavigationPayload(options = {}) {
  return {
    capabilityId: 'SETTINGS_AUTO_OPEN_REVERSE_ENGINEERED',
    source: 'REVERSE_ENGINEERED',
    action: 'DISPATCH_SETTINGS_SHORTCUT',
    shortcut: SETTINGS_SHORTCUT,
    targetSection: 'accounts',
    timestamp: new Date().toISOString(),
    isOfficialApi: false
  };
}

module.exports = {
  getSettingsGuidance,
  getAssistedNavigationPayload,
  SETTINGS_SHORTCUT
};
