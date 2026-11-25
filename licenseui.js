'use strict';
/* آزمایش و مجوز: بعد از پایان، همه‌چیز دیده می‌شود ولی ثبت و تغییر بسته است؛ پشتیبان همیشه باز است. */
function HesabLicenseUI(host) {
  const info = () => host.info();
  const status = () => HesabLicense.evaluate(info(), HesabLicense.ledger(Core.state()));
  let last = { state: 'off', locked: false };
  const LOCKED = 'برای ثبت و تغییر، برنامه را فعال کنید («بیشتر ← فعال‌سازی»).';
  const ALLOW = /^\/api\/(auth\/|trial$|license$|backup-cancelled$)/;
  const base = Core.handle;
  Core.handle = async (path, method = 'GET', body) => {
    if (last.locked && method !== 'GET' && !ALLOW.test(path)) throw { bad: true, msg: LOCKED };
    return base(path, method, body);
  };
  async function stamp(start) {
    if (!Core.state()) return;
    await host.load?.(base);
    const i = info(), t = Core.state().trial ?? {};
    if (!i.configured) { last = { state: 'off', locked: false }; return; }
    const s = Math.min(...[i.first, t.start, start].filter(x => x > 0)), seen = Math.max(i.seen, i.license ? 0 : t.seen || 0);
    if (s !== t.start || seen - (t.seen || 0) > 6 * 36e5) { try { await base('/api/trial', 'POST', { start: s, seen }); } catch { } }
    last = status();
  }
  const baseRefresh = window.refresh;
  window.refresh = async () => { await stamp(); return baseRefresh(); };
  /* پشتیبانِ بازگردانده آزمایش را از نو شروع نمی‌کند: زودترین شروع می‌ماند. */
  const baseImport = Core.importBackup;
  Core.importBackup = async (...a) => { const start = Core.state()?.trial?.start, lic = Core.state()?.lic; const r = await baseImport(...a); await host.imported?.(base, lic); await stamp(start); return r; };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Core.state()) { const was = last.locked; stamp().then(() => { if (was !== last.locked && S.home) render(); }); } });

  const dateFa = ms => new Date(ms - 1).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
  const text = () => ({
    off: '', permanent: `فعال · دائمی${last.name ? ' · ' + last.name : ''}`,
    licensed: `فعال تا ${last.end ? dateFa(last.end) : ''}${last.name ? ' · ' + last.name : ''}`,
    trial: `دوره‌ی آزمایشی: ${fa(last.days ?? 0)} روز مانده`, legacy: `مهلت فعال‌سازی تا ${last.end ? dateFa(last.end) : ''} (${fa(last.days ?? 0)} روز)`,
    trialOver: 'دوره‌ی آزمایشی تمام شده است؛ دیدن حساب‌ها و گرفتن پشتیبان باز است.', expired: 'مجوز تمام شده است؛ دیدن حساب‌ها و گرفتن پشتیبان باز است.',
    tampered: 'این نسخه‌ی برنامه دستکاری شده است؛ نسخه‌ی اصلی را از فروشنده بگیرید.',
  })[last.state] ?? '';
  const warn = () => last.locked || ((last.state === 'trial' || last.state === 'legacy' || last.state === 'licensed') && last.days <= 7);
  const baseHome = window.viewHome;
  window.viewHome = () => { baseHome(); if (warn()) $('#view').insertAdjacentHTML('afterbegin', `<button class="banner" data-act="license">${text()}<br>برای فعال‌سازی لمس کنید.</button>`); };
  const baseMore = window.viewMore;
  window.viewMore = () => {
    baseMore();
    if (last.state !== 'off') $('#view h1').insertAdjacentHTML('afterend', `<h2>فعال‌سازی</h2><div class="card hint">${text()}</div><button class="ghost" data-act="license">فعال‌سازی و کد گوشی</button>`);
  };
  const baseForm = window.txForm;
  window.txForm = (...a) => { if (last.locked) { actions.license(); return; } return baseForm(...a); };
  const apply = async code => {
    const err = await host.activate(code, base);
    if (err) { $('#licerr').textContent = err; return; }
    await stamp();
    if (last.locked) { $('#licerr').textContent = text(); return; }
    closeSheet(); done('فعال شد'); await refresh(); window.hesabDrain?.();
  };
  Object.assign(actions, {
    license() {
      openSheet(`<form id="licf" novalidate><div class="phead"><h1>فعال‌سازی</h1><button type="button" class="x" data-act="close">بستن</button></div>
        <p class="hint">${text()}</p>
        <label>کد این گوشی</label><div class="raw" dir="ltr" style="text-align:center;font-size:17px">${esc(info().device)}</div>
        <div class="two"><button type="button" class="ghost" data-act="liccopy">کپی کد</button><button type="button" class="ghost" data-act="licshare">فرستادن کد</button></div>
        <p class="hint">این کد را برای فروشنده بفرستید و کد فعال‌سازی را بگیرید.</p>
        <label for="lict">کد فعال‌سازی</label><textarea id="lict" rows="4" dir="ltr" autocomplete="off"></textarea>
        <input id="licfile" type="file" hidden><button type="button" class="ghost" data-act="licpick">بارگذاری فایل مجوز</button>
        <div class="err" id="licerr" role="alert"></div><button class="primary">فعال‌سازی</button></form>`);
      $('#licf').onsubmit = e => { e.preventDefault(); apply($('#lict').value); };
      $('#licfile').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 10000) { $('#licerr').textContent = 'این فایل مجوز نیست.'; return; }
        apply(await f.text());
      };
    },
    liccopy() { host.copy(info().device); toast('کد گوشی کپی شد.'); },
    licshare() { host.share('کد گوشی برای فعال‌سازی «حساب من»:\n' + info().device); },
    licpick() { $('#licfile').click(); },
  });
}
