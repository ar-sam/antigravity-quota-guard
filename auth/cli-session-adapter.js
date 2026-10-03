/**
 * Antigravity Quota Guard — CLI Session Authentication Adapter
 * Implements R11 and R13 for official CLI authentication flows.
 *
 * Invariant: Prefers exact conversation resumption (`agy --conversation <id>`)
 * over workspace fallback (`agy -c`).
 */

'use strict';

/**
 * Returns the official CLI logout command.
 * @returns {string}
 */
function getLogoutCommand() {
  return 'agy /logout';
}

/**
 * Returns the official CLI login command.
 * @returns {string}
 */
function getLoginCommand() {
  return 'agy login';
}

/**
 * Resolves the resumption command adhering to exact resume semantics.
 * @param {string|null} conversationId
 * @param {string|null} [workspacePath]
 * @returns {string}
 */
function getResumeCommand(conversationId, workspacePath = null) {
  if (conversationId && typeof conversationId === 'string' && conversationId.trim().length > 0) {
    return `agy --conversation ${conversationId.trim()}`;
  }
  return 'agy -c';
}

/**
 * Returns CLI guidance steps in the specified locale.
 * @param {string} [locale='fa']
 * @param {string|null} [conversationId=null]
 * @returns {object}
 */
function getCliGuidance(locale = 'fa', conversationId = null) {
  const resumeCmd = getResumeCommand(conversationId);

  if (locale === 'fa') {
    return {
      title: 'دستورالعمل تعویض حساب در ترمینال (CLI)',
      steps: [
        '۱. اجرای دستور خروج از حساب: agy /logout',
        '۲. اجرای دستور ورود با حساب جدید: agy login',
        `۳. ادامه کار با حساب جدید: ${resumeCmd}`
      ],
      resumeCommand: resumeCmd
    };
  }

  return {
    title: 'CLI Account Switching Instructions',
    steps: [
      '1. Log out from current account: agy /logout',
      '2. Authenticate with new account: agy login',
      `3. Resume session with new account: ${resumeCmd}`
    ],
    resumeCommand: resumeCmd
  };
}

module.exports = {
  getLogoutCommand,
  getLoginCommand,
  getResumeCommand,
  getCliGuidance
};
