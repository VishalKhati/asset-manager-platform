'use strict';

/**
 * Session Filter
 *
 * Restricts trading to London and/or New York sessions (UTC).
 * London:   08:00 – 17:00 UTC
 * New York: 13:00 – 22:00 UTC
 *
 * Returns signal passthrough ('BUY'|'SELL') if session is active, null if not.
 */

const SESSIONS = {
  london:   { start: 8,  end: 17 },
  new_york: { start: 13, end: 22 },
};

class SessionFilter {
  constructor(config = {}) {
    this.sessions  = config.sessions  || ['london', 'new_york'];
    this.weight    = config.weight    ?? 1;
    this.name      = 'SessionFilter';
  }

  /**
   * @param {object[]} _candles  (unused — uses real-time clock)
   * @param {Date} [utcDate]     injectable for testing
   * @returns {{ signal: 'BUY'|'SELL'|'OPEN'|null, session: string|null, confidence: number }}
   */
  analyze(_candles, utcDate = new Date()) {
    const active = this.getActiveSession(utcDate);
    if (active) {
      return { signal: 'OPEN', session: active, confidence: 1 };
    }
    return { signal: null, session: null, confidence: 0 };
  }

  isActive(utcDate = new Date()) {
    return this.getActiveSession(utcDate) !== null;
  }

  getActiveSession(utcDate = new Date()) {
    const hour = utcDate.getUTCHours();
    for (const name of this.sessions) {
      const s = SESSIONS[name];
      if (s && hour >= s.start && hour < s.end) {
        return name;
      }
    }
    return null;
  }
}

module.exports = { SessionFilter };
