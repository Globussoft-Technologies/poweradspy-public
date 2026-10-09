'use strict';

/**
 * MySQL optimizer hint that aborts a SELECT after `maxExecutionMs` (MySQL 5.7.8+;
 * MariaDB ignores it as a comment). Insert right after the outermost SELECT keyword:
 *   `SELECT${timeCapHint(ms)} ...`
 *
 * Used by the OCR/OCB lease queries so one slow lease cannot hold a pool connection
 * for minutes and starve every other request (the 2026-10 Facebook lease outage).
 * Only a positive integer is interpolated; anything else → '' (no cap).
 */
function timeCapHint(maxExecutionMs) {
  return Number.isInteger(maxExecutionMs) && maxExecutionMs > 0
    ? ` /*+ MAX_EXECUTION_TIME(${maxExecutionMs}) */`
    : '';
}

module.exports = { timeCapHint };
