'use strict';
/* قانون‌های آزمایش و مجوز؛ فقط محاسبه (آزمون: android/tests.js). */
const HesabLicense = {
  TRIAL: 14 * 864e5,
  LEGACY_BEFORE: Date.UTC(2026, 10, 28, 20, 30), // دفترهای نسخه‌های فروخته‌شده پیش از لایسنس (تا پایان ۷ آذر ۱۴۰۵)
  GRACE: Date.UTC(2027, 0, 20, 20, 30), // مهلت ثابت همان‌ها: پایان ۳۰ دی ۱۴۰۵
  /* i: وضعیت گوشی از برنامه؛ b: {start, seen, created} از خود دفتر */
  evaluate(i, b = {}) {
    if (!i?.configured) return { state: 'off', locked: false };
    if (!i.genuine) return { state: 'tampered', locked: true };
    const days = ms => Math.max(1, Math.ceil(ms / 864e5));
    const L = i.license, t0 = Math.max(i.now, i.seen || 0);
    if (L && !L.expires) return { state: 'permanent', locked: false, name: L.name };
    if (L) return t0 < L.expires ? { state: 'licensed', locked: false, name: L.name, end: L.expires, days: days(L.expires - t0) } : { state: 'expired', locked: true, name: L.name, end: L.expires };
    const t = Math.max(t0, b.seen || 0);
    const start = Math.min(...[i.first, b.start, b.created, t].filter(x => x > 0));
    const legacy = Math.min(...[i.first, b.created, t].filter(x => x > 0)) < this.LEGACY_BEFORE;
    const end = legacy ? Math.max(start + this.TRIAL, this.GRACE) : start + this.TRIAL;
    return t < end ? { state: legacy ? 'legacy' : 'trial', locked: false, end, days: days(end - t) } : { state: 'trialOver', locked: true, end };
  },
  /* زودترین زمان واقعی ساخت در دفتر؛ تاریخی که کاربر می‌نویسد ملاک نیست. */
  created(s) {
    let m = 0;
    for (const x of [...s.audit.map(a => a.at), ...s.tx.map(t => t.createdAt), ...s.events.map(e => e.receivedAt)]) {
      const v = Date.parse(x); if (v > 0 && (!m || v < m)) m = v;
    }
    return m;
  },
  ledger(s) { return s ? { start: s.trial?.start, seen: s.trial?.seen, created: this.created(s) } : {}; },
};
if (typeof module !== 'undefined') module.exports = HesabLicense;
