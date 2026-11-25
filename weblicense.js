'use strict';
/* مجوز نسخه‌ی وب (آیفون): همان کد امضاشده‌ی HS1 سازنده‌ی کد. «کد گوشی» داخل دفتر است، پس با پشتیبان جابه‌جا می‌شود. */
const HesabWebLicense = {
  PUBLIC: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElQ6F0vmiq63xxCZD3Zxyx2RnxbyAHkltFVEdm9y5kPzJotAjk/QKLNtGPjhwOb1KC4UxbElLmsNc2Yxk+owCDQ==', // همان LicenseKey.java (آزمون یکی بودن: android/tests.js)
  B32: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  newDevice() { return [...crypto.getRandomValues(new Uint8Array(16))].map((x, i) => (i && i % 4 === 0 ? '-' : '') + this.B32[x & 31]).join(''); },
  bytes(b64) { return Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); },
  /* امضای DER به r||s برای WebCrypto */
  raw(der) {
    let p = 0;
    const int = () => {
      if (der[p++] !== 2) throw 0;
      const n = der[p++], v = der.slice(p, p += n); let k = 0;
      if (v.length !== n) throw 0;
      while (k < v.length - 1 && v[k] === 0) k++;
      const t = v.slice(k); if (t.length > 32) throw 0;
      const o = new Uint8Array(32); o.set(t, 32 - t.length); return o;
    };
    if (der[p++] !== 0x30 || der[p++] !== der.length - 2) throw 0;
    const r = int(), s = int();
    if (p !== der.length) throw 0;
    const o = new Uint8Array(64); o.set(r); o.set(s, 32); return o;
  },
  norm: s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''),
  /* {ok:{name,expires,issued}} یا {err} */
  async read(text, device) {
    const bad = { err: 'این کد مجوز معتبر نیست.' };
    try {
      const p = String(text ?? '').replace(/\s/g, '').split('.');
      if (p.length !== 3 || p[0] !== 'HS1' || !this.PUBLIC) return bad;
      const data = this.bytes(p[1]);
      const key = await crypto.subtle.importKey('spki', this.bytes(this.PUBLIC), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, this.raw(this.bytes(p[2])), data)) return bad;
      const f = {};
      for (const line of new TextDecoder().decode(data).split('\n')) { const eq = line.indexOf('='); if (eq > 0) f[line.slice(0, eq)] = line.slice(eq + 1); }
      const expires = Number(f.e), issued = Number(f.i);
      if (f.v !== '1' || !/^\d+$/.test(f.e ?? '') || !(issued > 0) || !Number.isSafeInteger(expires)) return bad;
      if (!device || this.norm(f.m) !== this.norm(device)) return { err: 'این کد برای گوشی دیگری است. کد گوشی را دوباره برای فروشنده بفرستید.' };
      return { ok: { name: f.n ?? '', expires, issued } };
    } catch { return bad; }
  },
  /* متن خطا یا وضعیت تازه‌ی مجوز برای ذخیره */
  async accept(text, lic, now) {
    const n = await this.read(text, lic?.device);
    if (!n.ok) return { err: n.err };
    if (n.ok.expires && n.ok.expires <= now) return { err: 'مدت این کد تمام شده است.' };
    const old = lic.code ? (await this.read(lic.code, lic.device)).ok : null;
    if (old && n.ok.issued < old.issued) return { err: 'مجوز تازه‌تری روی این گوشی فعال است.' };
    const fresh = !old || n.ok.issued > old.issued;
    return { lic: { device: lic.device, code: String(text).replace(/\s/g, ''), seen: fresh ? Math.max(n.ok.issued, now) : lic.seen ?? now }, ok: n.ok };
  },
};
if (typeof module !== 'undefined') module.exports = HesabWebLicense;
else if (!window.HesabAndroid) {
  let valid = null, first = store.get('licFirst', null);
  if (!(first > 0)) store.set('licFirst', first = Date.now());
  const lic = () => Core.state()?.lic ?? {};
  HesabLicenseUI({
    info: () => ({ configured: !!HesabWebLicense.PUBLIC, genuine: true, device: lic().device ?? '', first, now: Date.now(), seen: Math.max(Date.now(), lic().seen ?? 0), license: valid }),
    async load(base) {
      const l = lic(), now = Date.now();
      if (!l.device) { try { await base('/api/license', 'POST', { device: HesabWebLicense.newDevice(), code: null, seen: now }); } catch { } }
      else if (now - (l.seen ?? 0) > 6 * 36e5) { try { await base('/api/license', 'POST', { ...l, seen: now }); } catch { } }
      valid = lic().code ? (await HesabWebLicense.read(lic().code, lic().device)).ok ?? null : null;
    },
    async activate(code, base) {
      const r = await HesabWebLicense.accept(code, lic(), Date.now());
      if (r.err) return r.err;
      try { await base('/api/license', 'POST', r.lic); } catch { return 'مجوز ذخیره نشد؛ دوباره امتحان کنید.'; }
      valid = r.ok; return '';
    },
    /* پشتیبانِ پیش از فعال‌سازی، مجوز فعلی همین دفتر را از بین نبرد. */
    async imported(base, before) {
      const ok = async l => l?.code ? (await HesabWebLicense.read(l.code, l.device)).ok : null;
      if (await ok(before) && !await ok(lic())) { try { await base('/api/license', 'POST', { ...before }); } catch { } }
    },
    copy: t => navigator.clipboard?.writeText(t).catch(() => { }),
    share: t => navigator.share ? navigator.share({ text: t }).catch(() => { }) : navigator.clipboard?.writeText(t).then(() => toast('کپی شد.')).catch(() => { }),
  });
  if (Core.state()) refresh();
}
