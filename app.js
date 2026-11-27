'use strict';
const $ = (s, r = document) => r.querySelector(s);
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
const fa = v => String(v).replace(/\d/g, d => FA[d]);
const en = v => String(v).replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => AR.indexOf(d));
const group = n => String(n).replace(/\B(?=(\d{3})+$)/g, '٬');
const money = n => { const v = Core.unit.show(n, UNIT); return (v < 0 ? '−' : '') + fa(group(Math.abs(v))); };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = v => en(v).replace(/\D/g, '');
const KIND = { income: 'درآمد', expense: 'هزینه', transfer: 'انتقال' };
const isNeutral = t => t.neutral ?? S.home?.categories.find(c => c.id === t.categoryId)?.nature === 'neutral';
const personOpts = sel => '<option value="">—</option>' + (S.home?.people ?? []).map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
const catByCode = code => S.home.categories.find(c => c.code === code)?.id;
/* کارهای حساب اشخاص: [برچسب، نوع، کد دسته] */
const PERSON_OPS = [['قرض دادم', 'expense', 'loan_out'], ['دریافت طلب', 'income', 'receivable_in'], ['قرض گرفتم', 'income', 'loan_in'], ['پرداخت بدهی', 'expense', 'debt_out']];
const METHODS = ['نقد', 'کارت', 'انتقال بانکی', 'چک'];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { } }
};
/* واحد نمایش مبلغ (تنظیم همین گوشی). همه‌ی نمایش‌ها از money/unitName و همه‌ی ورودها از amtIn/readAmt می‌گذرند. */
let UNIT = store.get('unit', 'toman') === 'rial' ? 'rial' : 'toman';
const unitName = () => Core.unit.name(UNIT);
const amtIn = toman => toman ? fa(group(Math.abs(Core.unit.show(Number(toman), UNIT)))) : '';
const readAmt = v => Core.unit.parse(Number(digits(v) || 0), UNIT);
const UNIT_ERR = 'مبلغ ریالی باید به صفر ختم شود (کوچک‌ترین واحد ۱۰ ریال است).';
const amtTyping = e => { const d = digits(e.target.value).replace(/^0+/, ''); e.target.value = d ? fa(group(d)) : ''; };
const S = { home: null, stale: false, view: 'home', queue: store.get('queue', []), flushing: false, filter: {} };

function jalali(d) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
  return `${p.year.padStart(4, '0')}/${p.month.padStart(2, '0')}/${p.day.padStart(2, '0')}`;
}
const today = () => jalali(new Date());
const yesterday = () => jalali(new Date(Date.now() - 864e5));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

async function api(path, method = 'GET', body) { return Core.handle(path, method, body); }

let toastTimer;
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.hidden = false; el.classList.remove('withbtn');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2600);
}

/* صف ثبت بدون اینترنت: هر ثبت اول اینجا ذخیره می‌شود و با clientId یکتا ارسال می‌شود تا تکراری نشود. */
const saveQueue = () => store.set('queue', S.queue);
async function flush() {
  if (S.flushing) return;
  S.flushing = true;
  try {
    for (const it of [...S.queue]) {
      if (it.error) continue;
      try {
        await api('/api/transactions', 'POST', it.tx);
        S.queue = S.queue.filter(q => q.tx.clientId !== it.tx.clientId);
      } catch (e) {
        if (e.bad) it.error = e.msg; else { if (e.auth) showAuth(true); break; }
      }
      saveQueue();
    }
  } finally { S.flushing = false; }
}

async function refresh() {
  await flush();
  try {
    S.home = await api('/api/home');
    S.stale = false;
    checkBadges();
  } catch (e) {
    S.stale = true;
    if (e.auth) return showAuth(true);
  }
  render();
}

function render() {
  if (!S.home) return;
  $('#tabs').hidden = false;
  const tab = { stmt: 'accounts', person: 'accounts', report: 'more' }[S.view] ?? S.view;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
  /* حرکت ورود فقط وقتی صفحه عوض می‌شود، نه با هر تازه‌سازی */
  const entering = S.shown !== S.view; S.shown = S.view;
  const v = $('#view');
  if (entering) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); clearTimeout(S.enterTimer); S.enterTimer = setTimeout(() => v.classList.remove('enter'), 1400); }
  ({ home: viewHome, list: viewList, accounts: viewAccounts, stmt: viewStmt, person: viewPerson, report: viewReport, more: viewMore, inbox: viewInbox })[S.view]();
  moveTabInd();
  if (S.view === 'home') { const ht = homeTotals(S.home), tot = ht.cash + ht.bank; if (entering) countUp(0); else if (S.shownTotal != null && S.shownTotal !== tot) countUp(S.shownTotal); S.shownTotal = tot; }
}

/* نشانگر نوار پایین زیر تب فعال سُر می‌خورد */
function moveTabInd() {
  const t = $('#tabs'), on = $('#tabs button.on');
  if (!on) return t.style.setProperty('--tw', '0px');
  t.style.setProperty('--tx', (t.clientWidth - on.offsetLeft - on.offsetWidth) + 'px');
  t.style.setProperty('--tw', on.offsetWidth + 'px');
}
addEventListener('resize', () => moveTabInd());

/* عدد مانده از صفر تا مقدار واقعی بالا می‌رود */
function countUp(from = 0) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of document.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count), node = el.firstChild, t0 = performance.now(), ms = 900;
    if (!node || node.nodeType !== 3 || to === from) continue;
    const step = now => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      if (!node.isConnected) return;
      node.textContent = money(Math.round(from + (to - from) * e)) + ' ';
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
const ICON = {
  expense: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  income: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  transfer: '<svg viewBox="0 0 24 24"><path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};

/* accId: از دید یک حساب، انتقالِ خروجی قرمز و ورودی سبز است. */
function txRow(t, queued, accId) {
  const into = t.kind === 'income' || (accId && t.kind === 'transfer' && t.toAccountId === accId);
  const out = t.kind === 'expense' || (accId && t.kind === 'transfer' && t.accountId === accId);
  const neu = isNeutral(t), sign = neu && !accId ? 'neu' : into ? 'pos' : out ? 'neg' : '';
  const acc = S.home.accounts, nameOf = id => acc.find(a => a.id === id)?.name ?? '';
  const cat = S.home.categories.find(c => c.id === t.categoryId)?.name;
  const title = t.description || t.categoryName || cat || KIND[t.kind];
  const sub = (t.kind === 'transfer' ? `${t.accountName ?? nameOf(t.accountId)} ← ${t.toAccountName ?? nameOf(t.toAccountId)}` : (t.accountName ?? nameOf(t.accountId)))
    + (t.personName ? ' · ' + t.personName : '') + (neu ? ' · خنثی' : '');
  const data = queued ? `data-act="editq" data-id="${esc(t.clientId)}"` : `data-act="edit" data-id="${t.id}"`;
  const row = `<button class="item" ${data}>${txIcon(t)}<span class="t"><div>${esc(title)}${t.hasPhoto ? ' <span class="clip" aria-label="عکس دارد">📎</span>' : ''}${queued ? `<span class="tag">${queued === 'err' ? 'خطا' : 'در صف ارسال'}</span>` : ''}</div>
    <small>${fa(t.date)} · ${esc(sub)}</small></span><span class="amt ${sign}">${out ? '−' : neu ? '+' : ''}${money(t.amount)}${t.balance !== undefined ? `<small>مانده: ${money(t.balance)}</small>` : ''}</span></button>`;
  return queued || !t.id ? row : `<div class="sw"><div class="swa"><button type="button" data-act="edit" data-id="${t.id}">ویرایش</button><button type="button" class="d" data-act="swdel" data-id="${t.id}">حذف</button></div>${row}</div>`;
}
const queueRows = () => S.queue.map(q => txRow(q.tx, q.error ? 'err' : 'q')).join('');

function queueBanner() {
  const failed = S.queue.filter(q => q.error).length, waiting = S.queue.length - failed;
  let h = S.home.pending ? `<button class="banner bank" data-act="inbox">${fa(S.home.pending)} تراکنش بانکی منتظر تعیین تکلیف است.</button>` : '';
  for (const c of S.home.checks ?? []) if (c.diff && c.waiting)
    h += `<button class="banner" data-act="inbox">مانده‌ی ${esc(c.name)} ${money(Math.abs(c.diff))} ${unitName()} با پیامک بانک فرق دارد؛ ${fa(c.pending)} پیامک منتظر دارید. اول آن‌ها را تعیین تکلیف کنید.</button>`;
  for (const c of S.home.checks ?? []) if (c.diff && !c.waiting)
    h += `<button class="banner warn" data-act="stmt" data-id="${c.accountId}">مانده‌ی ${esc(c.name)} با پیامک بانک نمی‌خواند: اختلاف ${money(Math.abs(c.diff))} ${unitName()}. برای دیدن لمس کنید.</button>`;
  for (const b of S.home.budgets ?? [])
    h += `<button class="banner" data-act="report">${esc(b.name)}: ${fa(Math.round(b.spent * 100 / b.budget))}٪ سقف این ماه خرج شده (${money(b.spent)} از ${money(b.budget)}).</button>`;
  if (S.home.backupDue) h += `<button class="banner" data-act="backup">مدتی است پشتیبان نگرفته‌اید. برای گرفتن پشتیبان لمس کنید.</button>`;
  if (waiting) h += `<button class="banner" data-act="sync">${fa(waiting)} ثبت در صف ارسال است. برای ارسال لمس کنید.</button>`;
  if (failed) h += `<button class="banner" data-act="tab" data-v="list">${fa(failed)} ثبت رد شد و باید اصلاح شود.</button>`;
  return h;
}

/* موجودی خانه با یا بدون حساب‌های کسب‌وکار (انتخاب روی همین گوشی می‌ماند) */
const noBiz = () => !!S.home?.hasBusiness && store.get('noBiz', false);
const homeTotals = h => noBiz() ? h.personal : h;
function viewHome() {
  /* همه‌ی سبک‌ها یک چیدمان دارند (چیدمان «شکوفه»)؛ رنگ‌ها از متغیرهای هر سبک. کد چیدمان‌های قبلی پایین‌تر فعلاً بی‌استفاده مانده */
  return viewHomeBloom();
  const h = S.home, t = homeTotals(h), modern = modernSkin();
  const acts = `<div class="actions">
    <button class="a-out" data-act="new" data-k="expense">${ICON.expense}هزینه</button>
    <button data-act="new" data-k="income">${ICON.income}درآمد</button>
    <button data-act="new" data-k="transfer">${ICON.transfer}انتقال</button>
  </div>`;
  $('#view').innerHTML = `
  <div class="card hero"><button class="maskbtn" data-act="mask" aria-label="پنهان کردن مبلغ‌ها">${masked() ? ICON.eyeoff : ICON.eye}</button><div class="lbl">کل موجودی${noBiz() ? ' (بدون کسب‌وکار)' : ''}</div>
    <div class="big" data-count="${t.cash + t.bank}">${money(t.cash + t.bank)} <span class="unit">${unitName()}</span></div>
    <div class="row"><span>نقد: ${money(t.cash)}</span><span>بانک: ${money(t.bank)}</span></div>
    ${h.hasBusiness ? `<div class="spk bizk"><span></span><span><button type="button" class="${noBiz() ? '' : 'on'}" data-act="biz" data-v="0">همه</button><button type="button" class="${noBiz() ? 'on' : ''}" data-act="biz" data-v="1">بدون کسب‌وکار</button></span></div>` : ''}${modern ? acts : spark(t.series)}</div>
  ${queueBanner()}
  <button class="ghost" data-act="paste">چسباندن پیامک بانک</button>
  <button class="ghost" data-act="smsfile">خواندن فایل پیامک‌ها</button>
  ${modern ? '' : acts}
  ${homeTemplates(h)}
  ${homeDue(h)}
  <h2>این ماه</h2>
  ${modern ? monthChart(h, t) : appleSkin() ? monthRings(h) : `<div class="stats">
    <div class="card"><small>درآمد</small><b class="pos">${money(h.income)}</b></div>
    <div class="card"><small>هزینه</small><b class="neg">${money(h.expense)}</b></div>
    <div class="card"><small>خالص</small><b class="${h.net < 0 ? 'neg' : 'pos'}">${money(h.net)}</b></div>
  </div>`}
  ${wrapBanner(h)}${insightCard(h)}${streakCard(h)}${budgetRings(h)}${subsCard(h)}
  ${h.cats?.length ? `<h2>خرج این ماه به تفکیک دسته</h2><div class="card donutcard" data-act="report">${donut(h.cats, 'هزینه')}</div>` : ''}
  <h2>آخرین تراکنش‌ها</h2>
  ${h.recent.length || S.queue.length ? `<div class="list">${queueRows()}${byDay(h.recent, t => txRow(t))}</div>` : `<div class="card empty">هنوز تراکنشی ثبت نشده است.</div>`}`;
}

/* ثبت سریع و سررسیدهای صفحه‌ی خانه (مشترک میان سبک‌ها) */
const homeTemplates = h => `${h.templates?.length ? `<h2>ثبت سریع</h2><p class="hint tplhint">لمس کنید، مبلغ را ببینید و «ثبت» را بزنید؛ ✎ برای عوض کردن مبلغ.</p><div class="chips">${h.templates.map(t => `<span class="tplc"><button class="chip go" data-act="tplgo" data-id="${t.id}">${t.kind === 'transfer' ? '⇄' : catEmoji(h.categories.find(c => c.id === t.categoryId)?.name, t.kind)} ${esc(t.name)} <small>${money(t.amount)}</small></button><button class="chip ed" data-act="tpl" data-id="${t.id}" aria-label="ویرایش و بعد ثبت ${esc(t.name)}">✎</button></span>`).join('')}</div>` : ''}`;
const homeDue = h => `${h.due?.length ? `<h2>سررسیدها</h2>${h.due.map(r => `<div class="card due"><div class="row"><b>${esc(r.name)}</b><b class="${r.kind === 'income' ? 'pos' : 'neg'}">${money(r.amount)}</b></div>
    <small class="${r.overdue ? 'neg' : ''}">سررسید ${fa(r.next)}${r.overdue ? ' (گذشته)' : ''}${r.left ? ` · ${fa(r.left)} دفعه مانده` : ''}</small>
    <div class="two"><button class="ghost" data-act="duepay" data-id="${r.id}">ثبت</button><button class="ghost" data-act="dueskip" data-id="${r.id}">این بار نه</button></div></div>`).join('')}` : ''}`;

/* ---------- سبک «طلایی شب»: مشکی و طلایی؛ همه‌ی جلوه‌ها ثابت (SVG و گرادیان)، بدون blur و انیمیشن ---------- */
const LUXE_PAL = ['#f5be46', '#3b82f6', '#a855f7', '#22c55e', '#ef4444', '#8e8e93'];
const LUXE_ART = `<svg class="lxart" viewBox="0 0 170 120" aria-hidden="true"><defs>
  <linearGradient id="lxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a3"/><stop offset=".5" stop-color="#f2b53c"/><stop offset="1" stop-color="#9a6510"/></linearGradient>
  <linearGradient id="lxa" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#b9821f" stop-opacity="0"/><stop offset=".45" stop-color="#e8a93a"/><stop offset="1" stop-color="#ffe08a"/></linearGradient></defs>
  <path d="M8 104 C40 96 62 84 86 62 S128 26 150 14" fill="none" stroke="url(#lxa)" stroke-width="7" stroke-linecap="round"/><path d="M136 8 156 10 152 30Z" fill="#ffd36b"/>
  ${[[28, 3], [58, 5], [88, 7], [118, 9]].map(([x, n]) => Array.from({ length: n }, (_, i) => `<ellipse cx="${x}" cy="${112 - i * 8}" rx="13" ry="4.5" fill="url(#lxg)" stroke="#7a4e0c" stroke-width=".6"/>`).join('')).join('')}</svg>`;
const luxeTile = (act, k, label, icon) => `<button class="lxt" data-act="${act}"${k ? ` data-k="${k}"` : ''}><i>${icon}</i>${label}</button>`;
function luxeTrend(series) {
  if (!series?.length) return '';
  const n = store.get('sparkN', 30), pts = series.slice(-n), vals = pts.map(p => p.total);
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 300, H = 110, pad = 14;
  const X = i => i * W / Math.max(1, pts.length - 1), Y = v => hi === lo ? H / 2 : pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
  const P2 = vals.map((v, i) => [X(i), Y(v)]);
  const d = P2.map(([x, y], i) => !i ? `M${x.toFixed(1)} ${y.toFixed(1)}` : `Q${P2[i - 1][0].toFixed(1)} ${P2[i - 1][1].toFixed(1)} ${((P2[i - 1][0] + x) / 2).toFixed(1)} ${((P2[i - 1][1] + y) / 2).toFixed(1)}`).join(' ') + ` L${W} ${P2[P2.length - 1][1].toFixed(1)}`;
  const top = vals.lastIndexOf(hi), [tx, ty] = P2[top], tl = Math.min(Math.max(tx, 60), W - 60);
  return `<div class="card lxtrend"><div class="lxh"><b>روند موجودی</b><span class="lxper"><button type="button" class="${n === 30 ? 'on' : ''}" data-act="spark" data-n="30">۳۰ روز</button><button type="button" class="${n === 90 ? 'on' : ''}" data-act="spark" data-n="90">۹۰ روز</button></span></div>
    <div class="lxchart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="lxf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5be46" stop-opacity=".45"/><stop offset="1" stop-color="#f5be46" stop-opacity="0"/></linearGradient></defs>
      ${[1, 2, 3].map(i => `<line x1="0" x2="${W}" y1="${(H * i / 4).toFixed(1)}" y2="${(H * i / 4).toFixed(1)}" class="lxgl"/>`).join('')}
      <path d="${d} L${W} ${H} L0 ${H} Z" fill="url(#lxf)"/><path d="${d}" class="lxln"/></svg>
      <i class="lxdot" style="left:${(tx * 100 / W).toFixed(1)}%;top:${(ty * 100 / H).toFixed(1)}%"></i>
      <span class="lxtip amtx" style="left:${(tl * 100 / W).toFixed(1)}%;top:${(ty * 100 / H).toFixed(1)}%">${money(hi)} <small>${unitName()}</small></span></div>
    <div class="lxax"><span>${fa(pts[0].date.slice(5))}</span><span>${fa(pts[pts.length - 1].date.slice(5))}</span></div></div>`;
}
function viewHomeLuxe() {
  const h = S.home, t = homeTotals(h), total = t.cash + t.bank;
  const ser = (t.series ?? []).slice(-30), first = ser[0]?.total ?? total, diff = total - first;
  const pct = first > 0 ? Math.round(diff * 1000 / first) / 10 : null;
  const delta = diff ? `<span class="lxd ${diff > 0 ? 'pos' : 'neg'}">${diff > 0 ? '▲' : '▼'} ${pct !== null ? fa(Math.abs(pct)).replace('.', '٫') + '٪' : `<b class="amtx">${money(Math.abs(diff))}</b>`} <small>۳۰ روز</small></span>` : '';
  const d = new Date(), wd = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const accs = h.accounts.slice(0, 4).map(a => `<button class="lxacc" data-act="stmt" data-id="${a.id}"><i class="ci" style="--tile:${a.kind === 'cash' ? '#b8862b' : '#2f6fe0'}">${a.kind === 'cash' ? CAT_SVG['👛'][1] : CAT_SVG['🏦'][1]}</i><span><small>${esc(a.name)}</small><b class="amtx ${a.balance < 0 ? 'neg' : ''}">${money(a.balance)}</b></span></button>`).join('');
  $('#view').innerHTML = `
  <div class="lxhead"><div><b>حساب من</b><small>${wd}</small></div><button class="lxgear" data-act="search" aria-label="جستجو در تراکنش‌ها">${SV('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4.2-4.2')}</button></div>
  <div class="card hero lxhero"><button class="maskbtn" data-act="mask" aria-label="پنهان کردن مبلغ‌ها">${masked() ? ICON.eyeoff : ICON.eye}</button>${LUXE_ART}
    <div class="lbl">وضعیت مالی شما${noBiz() ? ' (بدون کسب‌وکار)' : ''}</div>
    <div class="big" data-count="${total}" style="--n:${money(total).length}">${money(total)}</div><div class="lxu">${unitName()} ${delta}</div>
    <div class="row"><span>نقد: ${money(t.cash)}</span><span>بانک: ${money(t.bank)}</span></div>
    ${h.hasBusiness ? `<div class="spk bizk"><span></span><span><button type="button" class="${noBiz() ? '' : 'on'}" data-act="biz" data-v="0">همه</button><button type="button" class="${noBiz() ? 'on' : ''}" data-act="biz" data-v="1">بدون کسب‌وکار</button></span></div>` : ''}</div>
  ${queueBanner()}
  <div class="lxtiles">${luxeTile('new', 'expense', 'هزینه', ICON.expense)}${luxeTile('new', 'income', 'درآمد', ICON.income)}${luxeTile('new', 'transfer', 'انتقال', ICON.transfer)}
    ${luxeTile('report', '', 'گزارش', SV('M5 20V10M10 20V4M15 20v-7M20 20v-11'))}${luxeTile('inbox', '', 'پیامک بانک', SV('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5Z'))}</div>
  ${homeTemplates(h)}${homeDue(h)}
  ${luxeTrend(t.series)}
  <div class="lxsplit">
    <div class="card lxcol"><div class="lxh"><b>تحلیل هزینه‌ها</b></div>${h.cats?.length ? donut(h.cats.slice(0, 3).concat(h.cats.length > 3 ? [{ name: null, amount: h.cats.slice(3).reduce((s, x) => s + x.amount, 0) }] : []).filter(x => x.amount), 'هزینه', LUXE_PAL) : '<p class="hint">این ماه خرجی نیست.</p>'}
      <button class="lxmore" data-act="report">مشاهده جزئیات ‹</button></div>
    <div class="card lxcol"><div class="lxh"><b>حساب‌های شما</b></div><div class="lxaccs">${accs}</div><button class="lxmore" data-act="tab" data-v="accounts">مدیریت حساب‌ها ‹</button></div>
  </div>
  <div class="lxh lxsec"><b>آخرین تراکنش‌ها</b><button class="lxmore" data-act="tab" data-v="list">مشاهده همه ‹</button></div>
  ${h.recent.length || S.queue.length ? `<div class="list">${queueRows()}${byDay(h.recent.slice(0, 6), t => txRow(t))}</div>` : `<div class="card empty">هنوز تراکنشی ثبت نشده است.</div>`}
  ${wrapBanner(h)}${budgetRings(h)}${subsCard(h)}${insightCard(h)}`;
}

/* ---------- سبک «شکوفه»: آبی و یاسی روشن با تصویر کارت موجودی (bloom-art.webp، بریده از طرح کاربر) ---------- */
/* طرح کارت موجودی در سبک‌های غیر از «شکوفه» و «طلایی شب»: ستون‌های رو به بالا و خط روند، هم‌رنگ سبک (currentColor) */
const HERO_ART = `<svg class="bmsvg" viewBox="0 0 160 120" aria-hidden="true"><g fill="currentColor"><rect x="14" y="78" width="18" height="34" rx="5" opacity=".22"/><rect x="42" y="62" width="18" height="50" rx="5" opacity=".3"/><rect x="70" y="70" width="18" height="42" rx="5" opacity=".26"/><rect x="98" y="44" width="18" height="68" rx="5" opacity=".38"/><rect x="126" y="24" width="18" height="88" rx="5" opacity=".48"/></g><path d="M12 70 50 50l28 12 36-30 34-20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="m136 10 14 2-4 14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BLOOM_PAL = ['#1e3a8a', '#ec4899', '#a78bfa', '#38bdf8', '#f59e0b', '#94a3b8'];
/* عدد کوتاه برای محور نمودار (به واحد نمایش): ۱۵۰M */
const compactAmt = v => { const x = Core.unit.show(v, UNIT), a = Math.abs(x); return (x < 0 ? '−' : '') + (a >= 1e9 ? fa(+(a / 1e9).toFixed(1)) + 'B' : a >= 1e6 ? fa(Math.round(a / 1e6)) + 'M' : a >= 1e3 ? fa(Math.round(a / 1e3)) + 'K' : fa(a)); };
function bloomTrend(series) {
  if (!series?.length) return '';
  const n = store.get('bloomN', 90), pts = series.slice(-n), vals = pts.map(p => p.total);
  let lo = Math.min(...vals, 0), hi = Math.max(...vals); if (hi === lo) hi = lo + 1; hi += (hi - lo) * .45; // جای برچسب بالای نمودار
  const W = 300, H = 130, X = i => i * W / Math.max(1, pts.length - 1), Y = v => 8 + (H - 16) * (1 - (v - lo) / (hi - lo));
  const P2 = vals.map((v, i) => [X(i), Y(v)]);
  const d = P2.map(([x, y], i) => !i ? `M${x.toFixed(1)} ${y.toFixed(1)}` : `Q${P2[i - 1][0].toFixed(1)} ${P2[i - 1][1].toFixed(1)} ${((P2[i - 1][0] + x) / 2).toFixed(1)} ${((P2[i - 1][1] + y) / 2).toFixed(1)}`).join(' ') + ` L${W} ${P2[P2.length - 1][1].toFixed(1)}`;
  const top = vals.lastIndexOf(Math.max(...vals)), [tx, ty] = P2[top], tl = Math.min(Math.max(tx, 56), W - 56);
  const dots = [...new Set([0, Math.round(pts.length / 4), Math.round(pts.length / 2), Math.round(pts.length * 3 / 4), top, pts.length - 1])].filter(i => i < pts.length)
    .map(i => `<i class="bmdot" style="left:${(P2[i][0] * 100 / W).toFixed(1)}%;top:${(P2[i][1] * 100 / H).toFixed(1)}%"></i>`).join('');
  const months = []; pts.forEach((p, i) => { const m = p.date.slice(5, 7); if (!i || m !== pts[i - 1].date.slice(5, 7)) months.push([i, Number(m)]); });
  const step = Math.ceil(months.length / 4), ml = months.filter((_, k) => k % step === 0).map(([i, m]) => `<span style="left:${(X(i) * 100 / W).toFixed(1)}%">${MONTHS[m - 1]}</span>`).join('');
  const per = [[90, '۳ ماه'], [180, '۶ ماه'], [365, '۱ سال']].map(([k, t]) => `<button type="button" class="${n === k ? 'on' : ''}" data-act="bloomn" data-n="${k}">${t}</button>`).join('');
  return `<div class="card bmtrend"><div class="lxh"><b><i class="bmic">${SV('M5 20V10M10 20V4M15 20v-7M20 20v-11')}</i>روند مالی ${n === 365 ? 'یک سال' : fa(n / 30) + ' ماه'} اخیر</b><span class="bmper">${per}</span></div>
    <div class="bmplot"><div class="bmy"><span>${compactAmt(Math.max(...vals))}</span><span>${compactAmt((Math.max(...vals) + lo) / 2)}</span><span>${compactAmt(lo)}</span></div>
    <div class="bmchart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="bmf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6fe0" stop-opacity=".45"/><stop offset="1" stop-color="#3b6fe0" stop-opacity=".03"/></linearGradient></defs>
      ${[0, 1, 2, 3, 4].map(i => `<line x1="${W * i / 4}" x2="${W * i / 4}" y1="0" y2="${H}" class="bmgl"/>`).join('')}${[0, 1, 2].map(i => `<line x1="0" x2="${W}" y1="${(8 + (H - 16) * i / 2).toFixed(1)}" y2="${(8 + (H - 16) * i / 2).toFixed(1)}" class="bmgl"/>`).join('')}
      <path d="${d} L${W} ${H} L0 ${H} Z" fill="url(#bmf)"/><path d="${d}" class="bmln"/></svg>${dots}
      <span class="bmtip amtx" style="left:${(tl * 100 / W).toFixed(1)}%;top:${(ty * 100 / H).toFixed(1)}%">${money(Math.max(...vals))}<small>${unitName()}</small></span>
      <div class="bmx">${ml}</div></div></div></div>`;
}
/* تاریخ امروز با اسم روز، مثل «پنجشنبه ۶ آذر ۱۴۰۵» */
const todayLong = (d = new Date()) => { const p = {}; for (const x of new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d)) p[x.type] = x.value; return `${p.weekday} ${p.day} ${p.month} ${p.year}`; };
/* عکس پروفایل: فقط روی همین دستگاه (localStorage «avatar»)، جدا از اطلاعات رمزدار و بیرون از پشتیبان */
const avatarBtn = () => { const src = store.get('avatar', null); return `<button type="button" class="bmav${src ? ' img' : ''}" data-act="avatar" aria-label="${src ? 'عکس پروفایل' : 'گذاشتن عکس پروفایل'}">${src ? `<img src="${esc(src)}" alt="">` : SV('M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM3.5 21a8.5 8.5 0 0 1 17 0')}</button>`; };
/* عکس را مربعی از وسط می‌بُرد و ۲۰۰×۲۰۰ می‌کند (چند کیلوبایت) */
function avatarShrink(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { try { const n = 200, s = Math.min(im.naturalWidth, im.naturalHeight), c = document.createElement('canvas'); c.width = c.height = n;
      c.getContext('2d').drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, n, n); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', .85)); } catch (e) { no(e); } };
    im.onerror = () => { URL.revokeObjectURL(url); no(new Error('img')); }; im.src = url;
  });
}
function avatarPick() {
  let f = $('#avf'); if (!f) { f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.id = 'avf'; f.hidden = true; document.body.append(f);
    f.onchange = async () => { const file = f.files[0]; f.value = ''; if (!file) return;
      try { const d = await avatarShrink(file); if (!store.set('avatar', d)) throw 0; closeSheet(); render(); toast('عکس پروفایل گذاشته شد.'); } catch { toast('عکس خوانده نشد یا جا نیست.'); } }; }
  f.click();
}
function viewHomeBloom() {
  const h = S.home, t = homeTotals(h), total = t.cash + t.bank;
  const ser = t.series ?? [], ago = ser.length > 30 ? ser[ser.length - 31].total : ser[0]?.total ?? total, diff = total - ago;
  const pct = ago > 0 ? Math.round(diff * 1000 / ago) / 10 : null;
  const delta = `<span class="lxd ${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '▲' : '▼'} ${pct !== null ? (diff >= 0 ? '+' : '−') + fa(Math.abs(pct)).replace('.', '٫') + '٪' : `<b class="amtx">${money(Math.abs(diff))}</b>`}</span> <small>نسبت به ماه قبل</small>`;
  const banks = h.accounts.filter(a => a.kind === 'bank').length, pend = Number(h.pending) || 0;
  const accs = h.accounts.slice(0, 4).map(a => `<button class="lxacc" data-act="stmt" data-id="${a.id}"><i class="ci" style="--tile:${a.kind === 'cash' ? '#38bdf8' : a.business ? '#6366f1' : '#ef4444'}">${a.kind === 'cash' ? CAT_SVG['👛'][1] : CAT_SVG['🏦'][1]}</i><span><small>${esc(a.name)}</small><b class="amtx ${a.balance < 0 ? 'neg' : ''}">${money(a.balance)}</b></span></button>`).join('');
  const tile = (act, k, label, icon) => `<button class="card bmt" data-act="${act}"${k ? ` data-k="${k}"` : ''}><i>${icon}</i>${label}</button>`;
  $('#view').innerHTML = `
  <div class="bmhead"><div class="bmme">${avatarBtn()}<span><b>سلام 👋</b><small>${todayLong()}</small></span></div>
    <span class="bmicons"><button class="bmround" data-act="inbox" aria-label="پیامک‌های بانک">${SV('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20a2 2 0 0 0 4 0')}${pend ? `<em>${fa(pend)}</em>` : ''}</button>
    <button class="bmround" data-act="search" aria-label="جستجو در تراکنش‌ها">${SV('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4.2-4.2')}</button></span></div>
  <div class="card hero bmhero">${bloomSkin() ? '<img class="bmart" src="bloom-art.webp" alt="" aria-hidden="true">' : luxeSkin() ? LUXE_ART : HERO_ART}
    <div class="bmtext"><div class="lbl"><button class="maskbtn" data-act="mask" aria-label="پنهان کردن مبلغ‌ها">${masked() ? ICON.eyeoff : ICON.eye}</button>وضعیت مالی شما${noBiz() ? ' (بدون کسب‌وکار)' : ''}</div>
    <div class="big" data-count="${total}" style="--n:${money(total).length}">${money(total)}</div><div class="bmunit">${unitName()}</div>
    <div class="bmdelta">${delta}</div></div>
    ${h.hasBusiness ? `<div class="spk bizk"><span></span><span><button type="button" class="${noBiz() ? '' : 'on'}" data-act="biz" data-v="0">همه</button><button type="button" class="${noBiz() ? 'on' : ''}" data-act="biz" data-v="1">بدون کسب‌وکار</button></span></div>` : ''}</div>
  ${queueBanner()}
  <div class="bmtiles">${tile('report', '', 'گزارش‌ها', SV('M4 20h16M7 17v-5M12 17V7M17 17v-8'))}${tile('new', 'expense', 'هزینه', SV('M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'))}
    ${tile('new', 'income', 'درآمد', SV('M12 4v11M7 10l5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'))}${tile('receipt', '', 'عکس رسید', SV('M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5'))}</div>
  <button class="card bmbank" data-act="inbox"><i class="bmbk">${SV('M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18')}</i>
    <span><b>${banks ? fa(banks) + ' حساب بانکی در برنامه' : 'حساب بانکی تعریف نشده'}</b><small>${pend ? fa(pend) + ' پیامک بانک منتظر تأیید است' : 'پیامک‌های بانک را این‌جا وارد کنید'}</small></span><i class="bmgo">‹</i></button>
  ${homeTemplates(h)}${homeDue(h)}
  ${bloomTrend(t.series)}
  <div class="lxsplit">
    <div class="card lxcol"><div class="lxh"><b>تجزیه و تحلیل هزینه‌ها</b></div>${h.cats?.length ? donut(h.cats.slice(0, 3).concat(h.cats.length > 3 ? [{ name: null, amount: h.cats.slice(3).reduce((s, x) => s + x.amount, 0) }] : []).filter(x => x.amount), 'هزینه', bloomSkin() ? BLOOM_PAL : PAL) : '<p class="hint">این ماه خرجی نیست.</p>'}
      <button class="lxmore" data-act="report">مشاهده جزئیات ‹</button></div>
    <div class="card lxcol"><div class="lxh"><b>حساب‌های شما</b></div><div class="lxaccs">${accs}</div><button class="lxmore" data-act="tab" data-v="accounts">مدیریت حساب‌ها</button></div>
  </div>
  <div class="card bmrecent"><div class="lxh"><b><i class="bmic">${SV('M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4')}</i>آخرین تراکنش‌ها</b><button class="lxmore" data-act="tab" data-v="list">مشاهده همه ←</button></div>
  ${h.recent.length || S.queue.length ? `<div class="list">${queueRows()}${byDay(h.recent.slice(0, 6), t => txRow(t))}</div>` : `<div class="empty">هنوز تراکنشی ثبت نشده است.</div>`}</div>
  ${wrapBanner(h)}${budgetRings(h)}${subsCard(h)}${insightCard(h)}`;
}

/* سبک «اپل»: درآمد، هزینه و پس‌انداز ماه با سه حلقه (نسبت به بزرگ‌ترِ درآمد و هزینه) */
function monthRings(h) {
  const base = Math.max(h.income, h.expense) || 1, save = Math.max(h.net, 0);
  const rg = (r, v, c) => { const C = 2 * Math.PI * r, p = Math.min(1, Math.max(0, v / base));
    return `<circle cx="46" cy="46" r="${r}" style="stroke:var(--line)"/>${p ? `<circle cx="46" cy="46" r="${r}" stroke="${c}" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}"/>` : ''}`; };
  const pct = v => h.income > 0 ? ` · ${fa(Math.round(v * 100 / h.income))}٪` : '';
  return `<div class="card msum" data-act="report"><svg viewBox="0 0 92 92" aria-hidden="true"><g transform="rotate(-90 46 46)">${rg(40, h.income, '#34c759')}${rg(28, h.expense, '#ff375f')}${rg(16, save, '#0a84ff')}</g></svg>
    <div class="t"><div class="r"><span><i style="background:#34c759"></i>درآمد</span><b class="pos">${money(h.income)}</b></div>
    <div class="r"><span><i style="background:#ff375f"></i>هزینه${pct(h.expense)}</span><b class="neg">${money(h.expense)}</b></div>
    <div class="r"><span><i style="background:#0a84ff"></i>${h.net < 0 ? 'کسری' : 'پس‌انداز' + pct(save)}</span><b class="${h.net < 0 ? 'neg' : 'pos'}">${money(h.net)}</b></div></div></div>`;
}

/* سبک «بانک مدرن»: نمودار نرم موجودی و جمع ماه در یک کارت */
function monthChart(h, t) {
  return `<div class="card mchart">${spark(t.series, true)}<div class="mleg">
    <div><span>درآمد</span><b class="pos">${money(h.income)}</b></div><div><span>هزینه</span><b class="neg">${money(h.expense)}</b></div>
    <div><span>خالص</span><b class="${h.net < 0 ? 'neg' : 'pos'}">${money(h.net)}</b></div></div></div>`;
}

async function viewList() {
  const f = S.filter;
  $('#view').innerHTML = `<h1>تراکنش‌ها</h1>
  <input id="q" type="search" placeholder="جستجو در شرح و دسته" value="${esc(f.q)}" aria-label="جستجو">
  <select id="fa" aria-label="حساب"><option value="">همه‌ی حساب‌ها</option>${S.home.accounts.map(a => `<option value="${a.id}" ${String(a.id) === String(f.accountId ?? '') ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <div class="chips">${[['', 'همه'], ['expense', 'هزینه'], ['income', 'درآمد'], ['transfer', 'انتقال'], ['neutral', 'خنثی']].map(([k, t]) => `<button class="chip ${(f.kind || '') === k ? 'on' : ''}" data-act="fkind" data-k="${k}">${t}</button>`).join('')}</div>
  <div class="two"><div><label for="ff">از تاریخ</label>${dateInput('ff', esc(f.from), '۱۴۰۵/۰۸/۰۱')}</div>
  <div><label for="ft">تا تاریخ</label>${dateInput('ft', esc(f.to), '۱۴۰۵/۰۸/۳۰')}</div></div>
  <div id="rows" class="list mt"></div>
  <button class="ghost" data-act="export">خروجی اکسل (همین فهرست)</button>`;
  $('#q').oninput = debounce(e => { f.q = e.target.value; loadRows(); });
  $('#fa').onchange = e => { f.accountId = e.target.value; loadRows(); };
  for (const [id, k] of [['#ff', 'from'], ['#ft', 'to']]) $(id).onchange = e => { f[k] = normDate(e.target.value); e.target.value = f[k]; loadRows(); };
  loadRows();
}
function debounce(fn) { let t; return e => { clearTimeout(t); t = setTimeout(() => fn(e), 300); }; }
function normDate(v) {
  const m = en(v).trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : en(v).trim();
}
async function loadRows() {
  const f = S.filter, p = new URLSearchParams();
  for (const k of ['q', 'kind', 'accountId', 'from', 'to']) if (f[k]) p.set(k, f[k]);
  let rows, note = '';
  try { rows = await api('/api/transactions?' + p); S.rows = rows; }
  catch (e) {
    if (e.auth) return showAuth(true);
    rows = S.home.recent; note = '<div class="empty">بدون اتصال فقط آخرین تراکنش‌ها دیده می‌شوند.</div>';
  }
  const el = $('#rows'); if (!el) return;
  el.innerHTML = queueRows() + byDay(rows, t => txRow(t, null, Number(f.accountId) || null)) + note || '<div class="empty">موردی پیدا نشد.</div>';
}

function viewAccounts() {
  const list = S.home.accounts.map(bankCard).join('');
  const ppl = (S.home.people ?? []).map(p => `<button class="item" data-act="person" data-id="${p.id}"><span class="t"><div>${esc(p.name)}</div><small>${p.balance > 0 ? 'طلب شما' : p.balance < 0 ? 'بدهی شما' : 'تسویه'}</small></span><span class="amt ${p.balance > 0 ? 'pos' : p.balance < 0 ? 'neg' : ''}">${money(Math.abs(p.balance))}</span></button>`).join('');
  $('#view').innerHTML = `<h1>حساب‌ها</h1><div class="bcards">${list || '<div class="card empty">حسابی نیست.</div>'}</div>
  <button class="primary" data-act="acc">افزودن حساب</button>
  <h2>اشخاص (طلب و بدهی)</h2>${ppl ? `<div class="list">${ppl}</div>` : '<div class="card hint">قرض، طلب و بدهی هر شخص را اینجا جدا ببینید.</div>'}
  <button class="ghost" data-act="pform">افزودن شخص</button>
  <h2>هدف‌های پس‌انداز</h2>${(S.home.goals ?? []).length ? `<div class="goals">${S.home.goals.map(g => `<div class="card goal" data-act="goal" data-id="${g.id}">${ring(g.saved / g.target)}<span><b>${esc(g.name)}</b><small>${money(g.saved)} از ${money(g.target)}</small></span></div>`).join('')}</div>`
    : '<div class="card hint">برای خریدی که در نظر دارید هدف بگذارید و پیشرفتش را ببینید.</div>'}
  <button class="ghost" data-act="goal">هدف تازه</button>`;
}

async function viewStmt() {
  const id = S.accId;
  $('#view').innerHTML = '<div id="st"><div class="empty">در حال خواندن…</div></div>';
  let r;
  try { r = await api(`/api/accounts/${id}/statement`); }
  catch (e) { if (e.auth) return showAuth(true); $('#st').innerHTML = '<div class="card empty">صورت‌حساب باز نشد.</div>'; return; }
  S.rows = r.rows;
  const el = $('#st'); if (!el) return;
  el.innerHTML = `<button class="ghost" data-act="tab" data-v="accounts">بازگشت به حساب‌ها</button>
  <div class="card hero"><div class="lbl">${esc(r.account.name)}</div>
    <div class="big">${money(r.account.balance)} <span class="unit">${unitName()}</span></div>
    <div class="row"><span>موجودی اولیه: ${money(r.opening)}</span></div></div>
  ${checkCard(r.check)}
  ${r.account.kind === 'bank' ? `<button class="ghost" data-act="recon" data-id="${id}" data-b="${r.account.balance}">⚖️ تطبیق با موجودی بانک</button>` : ''}
  <button class="ghost" data-act="acc" data-id="${id}">ویرایش حساب</button>
  <h2>گردش حساب</h2>
  ${r.rows.length ? `<div class="list">${r.rows.map(t => txRow(t, null, id)).join('')}</div>` : '<div class="card empty">گردشی ثبت نشده است.</div>'}`;
}

async function viewPerson() {
  $('#view').innerHTML = '<div id="st"><div class="empty">در حال خواندن…</div></div>';
  let r;
  try { r = await api(`/api/people/${S.personId}/statement`); }
  catch (e) { if (e.auth) return showAuth(true); $('#st').innerHTML = '<div class="card empty">حساب این شخص باز نشد.</div>'; return; }
  S.rows = r.rows;
  const b = r.person.balance, el = $('#st'); if (!el) return;
  el.innerHTML = `<button class="ghost" data-act="tab" data-v="accounts">بازگشت به حساب‌ها</button>
  <div class="card hero"><div class="lbl">${esc(r.person.name)} · ${b > 0 ? 'طلب شما' : b < 0 ? 'بدهی شما' : 'تسویه'}</div>
    <div class="big">${money(Math.abs(b))} <span class="unit">${unitName()}</span></div></div>
  <div class="two">${PERSON_OPS.map(([t], i) => `<button class="ghost" data-act="pop" data-i="${i}">${t}</button>`).join('')}</div>
  ${b > 0 ? `<button class="primary" data-act="remind" data-n="${esc(r.person.name)}" data-b="${b}">📨 یادآوری طلب</button>` : ''}
  <button class="ghost" data-act="pform" data-id="${r.person.id}">ویرایش شخص</button>
  <h2>گردش</h2>
  ${r.rows.length ? `<div class="list">${r.rows.map(t => txRow(t)).join('')}</div>` : '<div class="card empty">هنوز چیزی ثبت نشده است.</div>'}`;
}

function personForm(p) {
  const o = p?.openingBalance ?? 0;
  openSheet(`<form id="pf2" novalidate><div class="phead"><h1>${p ? 'ویرایش شخص' : 'شخص تازه'}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <label for="pn">نام</label><input id="pn" autocomplete="off" value="${esc(p?.name)}">
    <label for="po">مانده‌ی اول (اختیاری)</label><input id="po" class="amount" inputmode="numeric" autocomplete="off" value="${amtIn(o)}">
    <select id="ps"><option value="1">او به من بدهکار است (طلب من)</option><option value="-1" ${o < 0 ? 'selected' : ''}>من به او بدهکارم</option></select>
    <div class="err" id="perr2" role="alert"></div><button class="primary">ذخیره</button>
    ${p ? `<button type="button" class="ghost danger" data-act="pdel" data-id="${p.id}">حذف از فهرست</button>` : ''}</form>`);
  $('#po').oninput = amtTyping;
  $('#pf2').onsubmit = async e => {
    e.preventDefault();
    const ob = readAmt($('#po').value); if (Number.isNaN(ob)) return $('#perr2').textContent = UNIT_ERR;
    const body = { name: $('#pn').value.trim(), openingBalance: ob * Number($('#ps').value) };
    try { const r = await api(p ? '/api/people/' + p.id : '/api/people', p ? 'PUT' : 'POST', body); closeSheet(); toast('ذخیره شد.');
      if (!p) { S.personId = r.id; S.view = 'person'; } refresh(); }
    catch (x) { x.auth ? showAuth(true) : $('#perr2').textContent = x.msg; }
  };
}

const nextMonth = ym => { let [y, m] = ym.split('/').map(Number); if (++m > 12) { m = 1; y++; } return `${y}/${String(m).padStart(2, '0')}`; };
const prevMonth = ym => { let [y, m] = ym.split('/').map(Number); if (--m < 1) { m = 12; y--; } return `${y}/${String(m).padStart(2, '0')}`; };
async function viewReport() {
  $('#view').innerHTML = '<div id="rp"><div class="empty">در حال خواندن…</div></div>';
  let r;
  try { r = await api('/api/report?month=' + encodeURIComponent(S.month ?? '')); }
  catch (e) { if (e.auth) return showAuth(true); $('#rp').innerHTML = '<div class="card empty">گزارش باز نشد.</div>'; return; }
  S.month = r.month;
  const cmp = (a, b, up) => { if (!b) return ''; const x = Math.round((a - b) * 100 / b); return `<small class="${x === 0 ? '' : (x > 0) === up ? 'pos' : 'neg'}">${x > 0 ? '+' : ''}${fa(x)}٪ نسبت به ماه قبل</small>`; };
  const max = Math.max(1, ...r.expenses.map(e => Math.max(e.amount, e.budget ?? 0)));
  const exp = r.expenses.map(e => `<button class="item" data-act="budget" data-id="${e.id}" data-n="${esc(e.name)}" data-b="${e.budget ?? ''}">${catIcon(e.name, 'expense')}<span class="t grow"><div>${esc(e.name)}</div>
    <small>ماه قبل ${money(e.prev)}${e.budget ? ` · سقف ${money(e.budget)}` : ''}</small>
    <span class="bar"><i class="${e.budget && e.amount > e.budget ? 'over' : ''}" style="width:${Math.round(e.amount * 100 / max)}%"></i>${e.budget ? `<u style="right:${Math.round(e.budget * 100 / max)}%"></u>` : ''}</span></span>
    <span class="amt neg">${money(e.amount)}</span></button>`).join('');
  const inc = r.incomes.map(e => `<div class="item">${catIcon(e.name, 'income')}<span class="t grow"><div>${esc(e.name)}</div><small>ماه قبل ${money(e.prev)}</small></span><span class="amt pos">${money(e.amount)}</span></div>`).join('');
  const el = $('#rp'); if (!el) return;
  el.innerHTML = `<h1>گزارش ماهانه</h1>
  <div class="two"><button class="ghost" data-act="month" data-d="-1">→ ${fa(prevMonth(r.month))}</button><button class="ghost" data-act="month" data-d="1">${fa(nextMonth(r.month))} ←</button></div>
  <h2>${fa(r.month)}</h2>
  <div class="stats">
    <div class="card"><small>درآمد</small><b class="pos">${money(r.income)}</b>${cmp(r.income, r.prevIncome, true)}</div>
    <div class="card"><small>هزینه</small><b class="neg">${money(r.expense)}</b>${cmp(r.expense, r.prevExpense, false)}</div>
    <div class="card"><small>خالص</small><b class="${r.income - r.expense < 0 ? 'neg' : 'pos'}">${money(r.income - r.expense)}</b></div>
  </div>
  ${r.expenses.some(e => e.amount > 0) ? `<div class="card donutcard">${donut(r.expenses.filter(e => e.amount > 0), 'هزینه')}</div>` : ''}
  <div class="two"><button class="ghost wrapbtn" data-act="wrap" data-m="${r.month}">🎬 جمع‌بندی ماه</button><button class="ghost wrapbtn" data-act="year" data-y="${r.month.slice(0, 4)}">📆 جمع‌بندی سال ${fa(r.month.slice(0, 4))}</button></div>
  <h2>تقویم خرج</h2><p class="hint">هر روز پررنگ‌تر = خرج بیشتر. روی هر روز بزنید تا تراکنش‌هایش را ببینید.</p>${heatmap(r)}
  <h2>روند ۶ ماه</h2>${trendChart(r.trend)}
  <h2>هزینه به تفکیک دسته</h2>
  <p class="hint">برای تعیین یا برداشتن سقف ماهانه روی هر دسته بزنید.${r.refund ? ` برگشت وجه این ماه (${money(r.refund)}) از جمع هزینه کم شده است.` : ''}</p>
  ${exp ? `<div class="list">${exp}</div>` : '<div class="card empty">هزینه‌ای ثبت نشده است.</div>'}
  <h2>درآمد به تفکیک دسته</h2>
  ${inc ? `<div class="list">${inc}</div>` : '<div class="card empty">درآمدی ثبت نشده است.</div>'}
  ${r.neutral?.length ? `<h2>خنثی</h2><p class="hint">در درآمد، هزینه و خالص حساب نشده است.</p><div class="list">${r.neutral.map(n => `<div class="item">${catIcon(n.name, 'neutral')}<span class="t grow"><div>${esc(n.name)}</div><small>ورودی ${money(n.in)} · خروجی ${money(n.out)}</small></span><span class="amt neu">${n.in < n.out ? '−' : ''}${money(Math.abs(n.in - n.out))}</span></div>`).join('')}</div>` : ''}`;
}

function recurringSheet() {
  const h = S.home, accs = h.accounts;
  const catOpts = kind => h.categories.filter(c => c.nature === 'neutral' || (c.type === kind && (c.nature === 'pnl' || ['loan_out', 'debt_out', 'loan_in', 'receivable_in'].includes(c.code))))
    .map(c => `<option value="${c.id}">${esc(c.name)}${c.nature === 'neutral' ? ' (خنثی)' : ''}</option>`).join('');
  const list = (h.recurring ?? []).map(r => `<div class="item"><span class="t"><div>${esc(r.name)}</div><small>هر ماه روز ${fa(r.day)} · بعدی ${fa(r.next)}${r.left ? ` · ${fa(r.left)} دفعه مانده` : ''}</small></span>
    <span class="amt ${r.kind === 'income' ? 'pos' : 'neg'}">${money(r.amount)}</span><button type="button" class="chip" data-act="delrec" data-id="${r.id}">حذف</button></div>`).join('');
  openSheet(`<form id="rf2" novalidate><div class="phead"><h1>پرداخت‌ها و دریافت‌های ماهانه</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <p class="hint">قسط، اجاره، قبض یا حقوق. چند روز مانده به سررسید در صفحه‌ی خانه دیده می‌شود و با «ثبت» وارد دفتر می‌شود. یادآوری بیرون از برنامه (اعلان) ممکن نیست.</p>
    ${list ? `<div class="list">${list}</div>` : ''}
    <h2>مورد تازه</h2>
    <label for="rn">نام</label><input id="rn" autocomplete="off" placeholder="مثلاً قسط وام">
    <label for="rk">نوع</label><select id="rk"><option value="expense">پرداخت</option><option value="income">دریافت</option></select>
    <label for="ra">مبلغ هر بار (${unitName()})</label><input id="ra" class="amount" inputmode="numeric" autocomplete="off">
    <label for="rc">دسته</label><select id="rc">${catOpts('expense')}</select>
    <label for="racc">حساب</label><select id="racc">${accs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
    ${h.people?.length ? `<label for="rp2">شخص (اختیاری)</label><select id="rp2">${personOpts(null)}</select>` : ''}
    <label for="rd">اولین سررسید</label>${dateInput('rd', fa(today()))}
    <label for="rl">تعداد دفعه‌ها (خالی = همیشگی)</label><input id="rl" inputmode="numeric" autocomplete="off">
    <div class="err" id="rerr2" role="alert"></div><button class="primary">افزودن</button></form>`);
  $('#rk').onchange = e => { $('#rc').innerHTML = catOpts(e.target.value); };
  $('#ra').oninput = amtTyping;
  $('#rf2').onsubmit = async e => {
    e.preventDefault();
    const left = digits($('#rl').value);
    const body = { name: $('#rn').value.trim(), kind: $('#rk').value, amount: readAmt($('#ra').value), categoryId: Number($('#rc').value) || null,
      accountId: Number($('#racc').value), personId: Number($('#rp2')?.value) || null, next: normDate($('#rd').value), left: left ? Number(left) : null };
    if (Number.isNaN(body.amount)) return $('#rerr2').textContent = UNIT_ERR;
    if (!body.amount) return $('#rerr2').textContent = 'مبلغ را وارد کنید.';
    try { await api('/api/recurring', 'POST', body); toast('اضافه شد.'); await refresh(); recurringSheet(); }
    catch (x) { x.auth ? showAuth(true) : $('#rerr2').textContent = x.msg; }
  };
}

async function exportCsv() {
  const f = S.filter, p = new URLSearchParams({ limit: 'all' });
  for (const k of ['q', 'kind', 'accountId', 'from', 'to']) if (f[k]) p.set(k, f[k]);
  try {
    const rows = await api('/api/transactions?' + p);
    if (!rows.length) return toast('موردی برای خروجی نیست.');
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const head = ['تاریخ', 'نوع', 'مبلغ (' + unitName() + ')', 'حساب', 'به حساب', 'دسته', 'شخص', 'شرح', 'یادداشت', 'روش پرداخت'].map(q).join(',');
    const lines = rows.slice().reverse().map(t => [q(`="${t.date}"`), q(t.neutral ? 'خنثی' : KIND[t.kind]), Core.unit.show(t.kind === 'expense' ? -t.amount : t.amount, UNIT),
      q(t.accountName), q(t.toAccountName), q(t.categoryName), q(t.personName), q(t.description), q(t.notes), q(t.method)].join(','));
    const name = `hesab-${today().replaceAll('/', '-')}.csv`;
    if (await saveFile(new File(['\uFEFF' + [head, ...lines].join('\r\n')], name, { type: 'text/csv' }))) toast(`خروجی ${fa(rows.length)} ردیف ساخته شد.`);
  } catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'خروجی ساخته نشد.'); }
}

function checkCard(c) {
  if (!c) return '';
  const when = fa(c.date) + (c.time ? ' ساعت ' + fa(c.time) : '');
  if (c.waiting) return `<div class="card hint">${c.diff ? `<b class="neg">اختلاف ${money(Math.abs(c.diff))} ${unitName()} با مانده‌ی پیامک بانک</b><br>` : ''}${fa(c.pending)} پیامک منتظر برای این حساب هست؛ اول آن‌ها را در صندوق پیامک‌ها تعیین تکلیف کنید تا مانده کنترل شود.<button class="ghost" data-act="inbox">صندوق پیامک‌ها</button></div>`;
  if (c.unknown) return `<div class="card hint">ترتیب پیامک‌های ${fa(c.date)} معلوم نیست (شاید پیامکی جا افتاده)؛ مانده‌ی این حساب با پیامک کنترل نشد. با موجودی همراه‌بانک مقایسه کنید.</div>`;
  if (!c.diff) return `<div class="card hint"><b class="pos">✓</b> با مانده‌ی آخرین پیامک بانک (${when}) یکی است.</div>`;
  return `<div class="card hint"><b class="neg">مانده با بانک نمی‌خواند</b><br>
    مانده در پیامک بانک (${when}): ${money(c.bank)} ${unitName()}<br>
    مانده‌ی برنامه در پایان همان روز: ${money(c.app)} ${unitName()}<br>
    اختلاف: ${money(c.diff)} ${unitName()}. ${c.diff > 0 ? 'برنامه کمتر از بانک است: شاید واریزی جا افتاده یا برداشتی دو بار ثبت شده.' : 'برنامه بیشتر از بانک است: شاید برداشت یا کارمزدی جا افتاده یا واریزی دو بار ثبت شده.'}
    اگر از اول اختلاف بوده، موجودی اولیه‌ی حساب را بررسی کنید.
    <button class="primary" data-act="fixcheck" data-id="${c.accountId}">ثبت ${money(Math.abs(c.diff))} ${unitName()} به‌عنوان ${c.diff < 0 ? 'کارمزد بانکی' : 'سایر درآمدها'}</button>
    <small class="hint">با تاریخ همان پیامک (${fa(c.date)}) ثبت می‌شود. اگر علت را می‌دانید (مثلاً ثبتی جا افتاده)، به‌جایش همان را درست کنید.</small></div>`;
}

function viewMore() {
  const cats = t => S.home.categories.filter(c => c.type === t && !c.code).map(c => `<button class="chip" data-act="delcat" data-id="${c.id}" data-n="${esc(c.name)}">${esc(c.name)} ×</button>`).join('');
  $('#view').innerHTML = `<h1>بیشتر</h1>
  <h2>دسته‌های هزینه</h2><div class="chips">${cats('expense')}<button class="chip" data-act="addcat" data-t="expense">+ دسته‌ی تازه</button></div>
  <h2>دسته‌های درآمد</h2><div class="chips">${cats('income')}<button class="chip" data-act="addcat" data-t="income">+ دسته‌ی تازه</button></div>
  <h2>دسته‌های خنثی</h2><p class="hint">موجودی حساب را کم و زیاد می‌کنند ولی در درآمد و هزینه حساب نمی‌شوند؛ مثل پول امانت یا خرید طلا.</p><div class="chips">${cats('neutral')}<button class="chip" data-act="addcat" data-t="neutral">+ دسته‌ی تازه</button></div>
  <h2>تراکنش‌های بانکی</h2><button class="ghost" data-act="inbox">صندوق پیامک‌های بانک</button>
  <h2>سبک ظاهر</h2><div class="skins">${SKINS.map(([k, n, , g]) => `<button class="skin ${(document.documentElement.dataset.skin || 'classic') === k ? 'on' : ''}" data-act="skin" data-k="${k}"><i style="background:${g}"></i>${n}</button>`).join('')}</div>
  <h2>رنگ برنامه</h2><p class="hint">رنگ نورها و دکمه‌ها در سبک‌های کلاسیک و شیشه‌ی مایع.</p><div class="chips">${ACCENTS.map(([k, n, c]) => `<button class="chip accent ${(document.documentElement.dataset.accent || 'blue') === k ? 'on' : ''}" data-act="accent" data-k="${k}"><i style="background:${c};color:${c}"></i>${n}</button>`).join('')}</div>
  <h2>واحد نمایش مبلغ</h2><p class="hint">اطلاعات عوض نمی‌شود؛ فقط نمایش و ورود مبلغ. ریال = ده برابر تومان.</p><div class="chips">${[['toman', 'تومان'], ['rial', 'ریال']].map(([k, n]) => `<button class="chip ${UNIT === k ? 'on' : ''}" data-act="unit" data-k="${k}">${n}</button>`).join('')}</div>
  ${badgesHtml()}
  <h2>نصب روی آیفون</h2><div class="card hint">در Safari دکمه‌ی Share و بعد Add to Home Screen را بزنید.</div>
  <h2>گزارش و برنامه‌ریزی</h2>
  <button class="ghost" data-act="report">گزارش ماهانه و سقف خرج</button>
  <button class="ghost" data-act="recman">پرداخت‌ها و دریافت‌های ماهانه</button>
  ${S.home.templates?.length ? `<h2>ثبت‌های آماده</h2><div class="chips">${S.home.templates.map(t => `<button class="chip" data-act="deltpl" data-id="${t.id}" data-n="${esc(t.name)}">${esc(t.name)} ×</button>`).join('')}</div>` : ''}
  <h2>پشتیبان</h2><div class="card hint">اطلاعات فقط روی همین گوشی است. فایل پشتیبان را در iCloud Drive یا جای امن دیگری نگه دارید. آخرین پشتیبان: ${S.home.lastBackup ? fa(new Date(S.home.lastBackup).toLocaleDateString('fa-IR')) : 'هنوز گرفته نشده'}</div>
  <button class="ghost" data-act="backup">گرفتن پشتیبان</button><button class="ghost" data-act="restore">بازیابی از فایل</button>
  <h2>امنیت</h2><button class="ghost" data-act="chpass">تغییر رمز</button>
  <button class="ghost danger" data-act="logout">قفل برنامه</button>
  ${window.HesabAndroid ? '' : `<h2>نسخه</h2><button class="ghost" data-act="checkupd">نسخه‌ی ${fa(VERSION.slice(1))} · بررسی نسخه‌ی تازه</button>`}`;
}

function openSheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false; }
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }

/* فرم ثبت و ویرایش تراکنش. src: تراکنش موجود، یا qid برای ثبت داخل صف */
function txForm(kind, src, qid, preset) {
  const accs = S.home.accounts;
  if (!accs.length) return toast('اول یک حساب بسازید.');
  const last = store.get('lastAcc', null), pre = src ?? preset;
  const accId = pre?.accountId ?? (accs.some(a => a.id === last) ? last : accs[0].id);
  const opts = sel => accs.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const toId = pre?.toAccountId ?? accs.find(a => a.id !== accId)?.id;
  const cats = S.home.categories.filter(c => c.type === kind && (c.nature === 'pnl' || c.id === pre?.categoryId));
  const neutrals = S.home.categories.filter(c => c.nature === 'neutral');
  const catId = pre?.categoryId ?? null;
  const date = src?.date ?? today();
  const editing = !!src;
  openSheet(`<form id="txf" data-kind="${kind}" data-id="${src?.id ?? ''}" data-qid="${esc(qid ?? '')}" data-rid="${preset?.recurringId ?? ''}" novalidate>
    <div class="phead"><h1>${editing ? 'ویرایش ' : ''}${KIND[kind]}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <label for="amt">مبلغ (${unitName()})</label>
    <input id="amt" class="amount" inputmode="numeric" autocomplete="off" value="${amtIn(pre?.amount)}">
    <div id="calc" class="calc" aria-live="polite"></div>
    <div class="chips ops"><button type="button" class="chip" data-act="zeros">۰۰۰+</button>${['+', '−', '×', '÷', '='].map(o => `<button type="button" class="chip op" data-act="op" data-o="${o}">${o}</button>`).join('')}</div>
    ${kind === 'transfer' ? `<label for="acc">از حساب</label><select id="acc">${opts(accId)}</select>
      <label for="to">به حساب</label><select id="to">${opts(toId)}</select>`
      : `<label>دسته</label><div class="chips" id="cats">${cats.map(c => `<button type="button" class="chip ${c.id === catId ? 'on' : ''}" data-act="cat" data-id="${c.id}">${catEmoji(c.name, kind)} ${esc(c.name)}</button>`).join('')}${neutrals.length ? `<small class="hint chipsep">خنثی (در درآمد و هزینه حساب نمی‌شود)</small>${neutrals.map(c => `<button type="button" class="chip ${c.id === catId ? 'on' : ''}" data-act="cat" data-id="${c.id}">${catEmoji(c.name, 'neutral')} ${esc(c.name)}</button>`).join('')}` : ''}</div>
      <label for="acc">حساب</label><select id="acc">${opts(accId)}</select>`}
    <label for="date">تاریخ</label>${dateInput('date', fa(date))}
    <div class="chips"><button type="button" class="chip" data-act="setdate" data-d="t">امروز</button><button type="button" class="chip" data-act="setdate" data-d="y">دیروز</button></div>
    ${kind !== 'transfer' && S.home.people?.length ? `<label for="per">شخص (اختیاری)</label><select id="per">${personOpts(pre?.personId ?? null)}</select>` : ''}
    ${kind === 'expense' && !editing && S.home.people?.length ? `<details id="splitd"><summary>👥 دنگ: تقسیم با دیگران</summary>
      <p class="hint">مبلغ مساوی تقسیم می‌شود و سهم هر نفر به‌عنوان طلب شما از او در «اشخاص» ثبت می‌شود.</p>
      <div class="chips" id="splitp">${S.home.people.map(p => `<button type="button" class="chip" data-act="splitp" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <label class="chk"><input type="checkbox" id="splitme" checked> سهم خودم هم هست</label><div id="splitv" class="hint"></div></details>` : ''}
    <label for="desc">شرح</label><input id="desc" autocomplete="off" value="${esc(pre?.description)}">
    <details ${src?.notes || src?.method ? 'open' : ''}><summary>جزئیات بیشتر</summary>
      <label for="method">روش پرداخت</label><select id="method"><option value=""></option>${METHODS.map(m => `<option ${m === pre?.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label for="notes">یادداشت</label><textarea id="notes" rows="2">${esc(src?.notes)}</textarea></details>
    ${qid ? '' : `<div class="photorow"><button type="button" class="ghost" data-act="photo">📷 عکس رسید</button><input type="file" id="phf" accept="image/*" hidden><div id="phv"></div></div>`}
    <div class="err" id="err" role="alert">${esc(src?.queueError)}</div>
    <button class="primary">${editing ? 'ذخیره' : 'ثبت'}</button>
    ${editing ? `<button type="button" class="ghost danger" data-act="deltx">حذف</button>` : `<button type="button" class="ghost" data-act="savetpl">ذخیره به‌عنوان ثبت آماده</button>`}
  </form>`);
  $('#amt').oninput = e => { e.target.value = fmtExpr(e.target.value); showCalc(); updateSplit(); };
  if ($('#splitme')) $('#splitme').onchange = updateSplit;
  S.catManual = !!catId;
  if ($('#cats')) $('#desc').oninput = debounce(async e => {
    if (S.catManual) return;
    const g = await api('/api/guess?kind=' + kind + '&q=' + encodeURIComponent(e.target.value)).catch(() => null);
    const chip = g && $(`#cats [data-id="${g.categoryId}"]`);
    if (chip && !chip.classList.contains('on') && !S.catManual) { $('#cats').querySelectorAll('.on').forEach(x => x.classList.remove('on', 'guessed')); chip.classList.add('on', 'guessed'); }
  });
  S.fphoto = undefined; // undefined = عوض نشده، null = حذف
  if ($('#phf')) $('#phf').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { S.fphoto = await shrinkPhoto(file); showPhoto(S.fphoto); } catch { toast('عکس خوانده نشد یا خیلی بزرگ است.'); }
    e.target.value = '';
  };
  if (editing && src.id) api(`/api/transactions/${src.id}/photo`).then(r => { if (r.data && S.fphoto === undefined) showPhoto(r.data); }).catch(() => { });
  $('#txf').onsubmit = e => { e.preventDefault(); submitTx(); };
  if (!editing) $('#amt').focus();
}

/* خواندن فرم ثبت؛ اگر ایرادی باشد متن خطا برمی‌گردد. */
function readTx() {
  const kind = $('#txf').dataset.kind;
  const amount = Core.unit.parse(calcExpr($('#amt').value), UNIT), date = normDate($('#date').value);
  const accountId = Number($('#acc').value);
  const toAccountId = kind === 'transfer' ? Number($('#to').value) : null;
  const categoryId = kind === 'transfer' ? null : Number($('#cats .on')?.dataset.id) || null;
  if (Number.isNaN(amount) && calcExpr($('#amt').value) > 0) return UNIT_ERR;
  if (!(amount > 0)) return 'مبلغ را وارد کنید.';
  if (kind !== 'transfer' && !categoryId) return 'دسته را انتخاب کنید.';
  if (kind === 'transfer' && accountId === toAccountId) return 'حساب مبدأ و مقصد نباید یکی باشند.';
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date)) return 'تاریخ را مثل ۱۴۰۵/۰۸/۱۵ وارد کنید.';
  return { kind, date, amount, accountId, toAccountId, categoryId, personId: Number($('#per')?.value) || null,
    description: $('#desc').value.trim() || null, notes: $('#notes').value.trim() || null, method: $('#method').value || null };
}

async function submitTx() {
  const f = $('#txf'), err = $('#err');
  const rt = readTx();
  if (typeof rt === 'string') return err.textContent = rt;
  const tx = { ...rt, recurringId: Number(f.dataset.rid) || null };
  store.set('lastAcc', rt.accountId);
  if (f.dataset.id) {
    try { await api('/api/transactions/' + f.dataset.id, 'PUT', tx); await savePhoto(Number(f.dataset.id)); closeSheet(); done('ذخیره شد'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : err.textContent = e.net ? 'ویرایش فقط با اتصال به سرور انجام می‌شود.' : e.msg; }
    return;
  }
  const sp = splitShares();
  if (sp) {
    if (!sp.total) return err.textContent = 'مبلغ را وارد کنید.';
    try { const r = await api('/api/split', 'POST', { ...tx, shares: sp.shares, clientId: uuid() }); await savePhoto(r.ids[0]); closeSheet(); done('ثبت شد · دنگ'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : err.textContent = e.msg; }
    return;
  }
  const qid = f.dataset.qid;
  if (qid) S.queue = S.queue.filter(q => q.tx.clientId !== qid);
  const cid = qid || uuid();
  S.queue.push({ tx: { ...tx, clientId: cid } });
  if (!saveQueue()) { err.textContent = 'حافظه‌ی گوشی پر است؛ ثبت ذخیره نشد.'; S.queue.pop(); return; }
  closeSheet();
  await flush();
  if (!S.queue.some(q => q.tx.clientId === cid)) await savePhoto(Core.state()?.tx.find(t => t.clientId === cid)?.id);
  const left = S.queue.length;
  left ? toast('در صف ارسال ماند؛ با وصل شدن ارسال می‌شود.') : done('ثبت شد');
  refresh();
}

function accForm(a) {
  openSheet(`<form id="af" novalidate><div class="phead"><h1>${a ? 'ویرایش حساب' : 'حساب تازه'}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <label for="an">نام حساب</label><input id="an" value="${esc(a?.name)}">
    <label for="ak">نوع</label><select id="ak"><option value="bank" ${a?.kind === 'bank' ? 'selected' : ''}>بانک</option><option value="cash" ${a?.kind === 'cash' ? 'selected' : ''}>نقد</option></select>
    <label for="ab">نام بانک</label><input id="ab" value="${esc(a?.bankName)}">
    <label for="au">شماره حساب (اختیاری)</label><input id="au" inputmode="numeric" class="date" value="${esc(a?.accountNumber)}">
    <div id="abank"><label for="acn">شماره کارت (اختیاری)</label><input id="acn" inputmode="numeric" class="date" autocomplete="off" placeholder="۱۶ رقم روی کارت" value="${esc(grp4(a?.cardNumber))}">
    <label for="aib">شماره شبا (اختیاری)</label><input id="aib" inputmode="numeric" class="date" autocomplete="off" placeholder="IR و ۲۴ رقم" value="${esc(grp4(a?.iban))}">
    <small class="hint" id="acnok"></small></div>
    <label for="ao">موجودی اولیه (${unitName()})</label><input id="ao" inputmode="numeric" class="date" value="${a ? amtIn(a.openingBalance) : ''}">
    <label class="chk"><input type="checkbox" id="abz" ${a?.business ? 'checked' : ''}> این حساب مال کسب‌وکار است</label>
    <p class="hint">در صفحه‌ی خانه می‌توانید موجودی را بدون حساب‌های کسب‌وکار ببینید.</p>
    <div class="err" id="err" role="alert"></div><button class="primary">ذخیره</button>
    ${a ? `<button type="button" class="ghost danger" data-act="archive" data-id="${a.id}">بایگانی حساب</button>` : ''}</form>`);
  $('#ao').oninput = amtTyping;
  /* شماره کارت و شبا: فقط رقم، چهارتایی جدا، با کنترل درستی همان لحظه */
  const card = () => digits($('#acn').value), iban = () => { const d = digits($('#aib').value); return d ? 'IR' + d : ''; };
  const checkNums = () => {
    const c = card(), i = iban(), m = [];
    if (c) m.push(c.length < 16 ? `شماره کارت: ${fa(c.length)} رقم از ۱۶` : Core.cardOk(c) ? '✓ شماره کارت درست است' : '✗ شماره کارت درست نیست');
    if (i) m.push(i.length < 26 ? `شبا: ${fa(i.length - 2)} رقم از ۲۴` : Core.ibanOk(i) ? '✓ شبا درست است' : '✗ شبا درست نیست');
    $('#acnok').textContent = m.join(' · ');
  };
  $('#acn').oninput = e => { e.target.value = grp4(card().slice(0, 16)); checkNums(); };
  $('#aib').oninput = e => { const d = digits(e.target.value).slice(0, 24); e.target.value = d ? grp4('IR' + d) : ''; checkNums(); };
  const kindShow = () => { $('#abank').hidden = $('#ak').value !== 'bank'; };
  $('#ak').onchange = kindShow; kindShow(); checkNums();
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const bank = $('#ak').value === 'bank', cn = bank ? card() : '', ib = bank ? iban() : '';
    if (cn && !Core.cardOk(cn)) return $('#err').textContent = 'شماره کارت درست نیست؛ ۱۶ رقم روی کارت را دوباره ببینید.';
    if (ib && !Core.ibanOk(ib)) return $('#err').textContent = 'شماره شبا درست نیست؛ IR و ۲۴ رقم بعدش را دوباره ببینید.';
    const sign = a && a.openingBalance < 0 ? -1 : 1;
    const ob = readAmt($('#ao').value); if (Number.isNaN(ob)) return $('#err').textContent = UNIT_ERR;
    const body = { name: $('#an').value, kind: $('#ak').value, bankName: $('#ab').value.trim() || null, accountNumber: en($('#au').value).trim() || null, cardNumber: cn || null, iban: ib || null, openingBalance: sign * ob, business: $('#abz').checked };
    try { await api('/api/accounts' + (a ? '/' + a.id : ''), a ? 'PUT' : 'POST', body); closeSheet(); toast('ذخیره شد.'); refresh(); }
    catch (x) { x.auth ? showAuth(true) : $('#err').textContent = x.msg; }
  };
}

const actions = {
  tab(b) { S.view = b.dataset.v; render(); window.scrollTo(0, 0); },
  /* ذره‌بین سربرگ: صفحه‌ی تراکنش‌ها با کادر جستجوی آماده (focus همان لحظه، تا صفحه‌کلید آیفون هم باز شود) */
  search() { S.view = 'list'; render(); window.scrollTo(0, 0); $('#q')?.focus(); },
  new(b) { txForm(b.dataset.k); },
  close: closeSheet,
  sync() { for (const q of S.queue) delete q.error; refresh(); },
  zeros() { const i = $('#amt'); if (/\d$/.test(en(i.value))) i.value = fmtExpr(i.value + '000'); showCalc(); i.focus(); },
  op(b) {
    const i = $('#amt'), o = b.dataset.o;
    if (o === '=') { const r = calcExpr(i.value); if (r > 0) i.value = fa(group(r)); /* عدد به واحد نمایش */ }
    else if (/\d$/.test(en(i.value))) i.value = fmtExpr(i.value + o);
    else if (i.value) i.value = i.value.replace(/[+−×÷]$/, o);
    showCalc(); i.focus();
  },
  cat(b) { $('#cats').querySelectorAll('.on').forEach(x => x.classList.remove('on', 'guessed')); b.classList.add('on'); S.catManual = true; },
  setdate(b) { $('#date').value = fa(b.dataset.d === 't' ? today() : yesterday()); },
  edit(b) {
    const id = Number(b.dataset.id);
    const t = (S.rows ?? []).concat(S.home.recent).find(x => x.id === id);
    if (t) txForm(t.kind, t);
  },
  editq(b) {
    const q = S.queue.find(x => x.tx.clientId === b.dataset.id);
    if (q) { txForm(q.tx.kind, { ...q.tx, queueError: q.error }, q.tx.clientId); $('#txf').dataset.id = ''; }
  },
  async deltx() {
    const f = $('#txf');
    if (!confirm('این تراکنش حذف شود؟')) return;
    if (f.dataset.qid) { S.queue = S.queue.filter(q => q.tx.clientId !== f.dataset.qid); saveQueue(); closeSheet(); return render(); }
    try { await api('/api/transactions/' + f.dataset.id, 'DELETE'); closeSheet(); toast('حذف شد.'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : $('#err').textContent = e.net ? 'حذف فقط با اتصال به سرور انجام می‌شود.' : e.msg; }
  },
  chpass() {
    openSheet(`<form id="cpf" novalidate><div class="phead"><h1>تغییر رمز</h1><button type="button" class="x" data-act="close">بستن</button></div>
      <p class="hint">پشتیبان‌های قبلی فقط با رمز قبلی باز می‌شوند. بعد از تغییر رمز یک پشتیبان تازه بگیرید. رمز تازه قابل بازیابی نیست.</p>
      <label for="op">رمز فعلی</label><input id="op" type="password" autocomplete="off">
      <label for="np">رمز تازه (حداقل ۶ حرف)</label><input id="np" type="password" autocomplete="off">
      <label for="np2">تکرار رمز تازه</label><input id="np2" type="password" autocomplete="off">
      <div class="err" id="cerr" role="alert"></div><button class="primary">تغییر رمز</button></form>`);
    $('#cpf').onsubmit = async e => {
      e.preventDefault();
      if ($('#np').value !== $('#np2').value) return $('#cerr').textContent = 'رمز تازه و تکرارش یکی نیستند.';
      const btn = $('#cpf .primary'); btn.disabled = true;
      try { await Core.changePassword($('#op').value, $('#np').value); closeSheet(); toast('رمز عوض شد. حالا یک پشتیبان تازه بگیرید.'); refresh(); }
      catch (x) { if (x.auth) return showAuth(true); $('#cerr').textContent = x.msg || 'رمز عوض نشد.'; btn.disabled = false; }
    };
  },
  tpl(b) { const t = S.home.templates.find(x => x.id === Number(b.dataset.id)); if (t) txForm(t.kind, null, null, t); },
  async savetpl() {
    const rt = readTx(); if (typeof rt === 'string') return $('#err').textContent = rt;
    const cat = S.home.categories.find(c => c.id === rt.categoryId)?.name;
    const name = prompt('نام ثبت آماده (روی دکمه نوشته می‌شود)', rt.description || cat || KIND[rt.kind]);
    if (!name?.trim()) return;
    try { await api('/api/templates', 'POST', { ...rt, name }); toast('ثبت آماده ساخته شد؛ در صفحه‌ی خانه است.'); await updateHome(); }
    catch (e) { e.auth ? showAuth(true) : $('#err').textContent = e.msg; }
  },
  async deltpl(b) {
    if (!confirm(`ثبت آماده‌ی «${b.dataset.n}» حذف شود؟`)) return;
    try { await api('/api/templates/' + b.dataset.id, 'DELETE'); refresh(); } catch (e) { toast(e.msg); }
  },
  duepay(b) {
    const r = S.home.recurring.find(x => x.id === Number(b.dataset.id)); if (!r) return;
    txForm(r.kind, null, null, { ...r, description: r.description ?? r.name, recurringId: r.id });
  },
  async dueskip(b) {
    if (!confirm('این سررسید بدون ثبت به ماه بعد برود؟')) return;
    try { await api(`/api/recurring/${b.dataset.id}/skip`, 'POST'); refresh(); } catch (e) { toast(e.msg); }
  },
  recman() { recurringSheet(); },
  async delrec(b) {
    if (!confirm('این مورد ماهانه حذف شود؟ ثبت‌های قبلی می‌مانند.')) return;
    try { await api('/api/recurring/' + b.dataset.id, 'DELETE'); await refresh(); recurringSheet(); } catch (e) { toast(e.msg); }
  },
  person(b) { S.personId = Number(b.dataset.id); S.view = 'person'; render(); window.scrollTo(0, 0); },
  pform(b) { personForm(b.dataset.id ? S.home.people.find(p => p.id === Number(b.dataset.id)) : null); },
  pop(b) {
    const [, kind, code] = PERSON_OPS[Number(b.dataset.i)];
    txForm(kind, null, null, { categoryId: catByCode(code), personId: S.personId });
  },
  async pdel(b) {
    if (!confirm('این شخص از فهرست برداشته شود؟ ثبت‌های قبلی می‌مانند.')) return;
    try { await api('/api/people/' + b.dataset.id, 'DELETE'); closeSheet(); S.view = 'accounts'; refresh(); } catch (e) { $('#perr2').textContent = e.msg; }
  },
  report() { S.view = 'report'; render(); window.scrollTo(0, 0); },
  month(b) { S.month = (b.dataset.d === '1' ? nextMonth : prevMonth)(S.month); render(); },
  async budget(b) {
    const v = prompt(`سقف خرج ماهانه‌ی «${b.dataset.n}» به ${unitName()} (خالی = بدون سقف)`, amtIn(b.dataset.b));
    if (v === null) return;
    const n = readAmt(v); if (Number.isNaN(n)) return toast(UNIT_ERR);
    try { await api(`/api/categories/${b.dataset.id}/budget`, 'PUT', { budget: n || null }); toast(n ? 'سقف ذخیره شد.' : 'سقف برداشته شد.'); refresh(); }
    catch (e) { toast(e.msg); }
  },
  export: exportCsv,
  stmt(b) { S.accId = Number(b.dataset.id); S.view = 'stmt'; render(); window.scrollTo(0, 0); },
  acc(b) { accForm(S.home.accounts.find(a => a.id === Number(b.dataset.id))); },
  bflip(b) { b.closest('.bcard').classList.toggle('flipped'); },
  bcopy(b) { copyText(b.dataset.v, 'کپی شد.'); },
  bcopyall(b) { const a = S.home.accounts.find(x => x.id === Number(b.closest('.bcard').dataset.id)); if (a) copyText(bankShareText(a), 'همه‌ی شماره‌ها کپی شد.'); },
  async bshare(b) {
    const a = S.home.accounts.find(x => x.id === Number(b.closest('.bcard').dataset.id)); if (!a) return;
    const text = bankShareText(a);
    if (navigator.share) { try { await navigator.share({ text }); } catch { } } else copyText(text, 'شماره‌ها کپی شد.');
  },
  async archive(b) {
    if (!confirm('این حساب بایگانی شود؟')) return;
    try { await api('/api/accounts/' + b.dataset.id, 'DELETE'); closeSheet(); S.view = 'accounts'; refresh(); } catch (e) { $('#err').textContent = e.msg; }
  },
  async addcat(b) {
    const name = prompt('نام دسته‌ی تازه');
    if (!name?.trim()) return;
    try { await api('/api/categories', 'POST', { name, type: b.dataset.t }); refresh(); } catch (e) { toast(e.msg); }
  },
  async delcat(b) {
    if (!confirm(`دسته‌ی «${b.dataset.n}» از فهرست برداشته شود؟ تراکنش‌های قبلی می‌مانند.`)) return;
    try { await api('/api/categories/' + b.dataset.id, 'DELETE'); refresh(); } catch (e) { toast(e.msg); }
  },
  fkind(b) { S.filter.kind = b.dataset.k; viewList(); },
  logout() { Core.lock(); S.home = null; showAuth(true); },
  async backup() {
    try {
      const text = await Core.exportBackup();
      const name = `hesab-${Core.todayJ().replaceAll('/', '-')}.hesab`;
      if (!await saveFile(new File([text], name, { type: 'application/octet-stream' }))) return toast('پشتیبان ذخیره نشد.');
      toast('فایل پشتیبان ساخته شد.'); refresh();
    } catch (e) { toast(e.msg || 'ساخت پشتیبان انجام نشد.'); }
  },
  restore() { restoreForm(false); }
};
document.addEventListener('click', e => {
  if (swGuard(e)) return;
  const b = e.target.closest('[data-act]');
  if (b) { e.preventDefault(); (actions[b.dataset.act] ?? calActs[b.dataset.act])?.(b); }
  else if (e.target.id === 'sheet') closeSheet();
  else if (e.target.id === 'cal') closeCal();
});

/* تاریخ: فقط رقم تایپ می‌شود و ممیزها خودکار گذاشته می‌شوند (صفحه‌کلید عددی آیفون «/» ندارد) */
const dateInput = (id, val, ph = '') => `<div class="field dfield"><input id="${id}" class="date" data-date inputmode="numeric" autocomplete="off" placeholder="${ph}" value="${val}"><button type="button" class="eye" data-act="cal" data-for="${id}" aria-label="انتخاب از تقویم">${ICON.cal}</button></div>`;
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.matches?.('[data-date]')) return;
  const n = digits(el.value).slice(0, 8);
  el.value = fa(n.slice(0, 4) + (n.length > 4 ? '/' + n.slice(4, 6) : '') + (n.length > 6 ? '/' + n.slice(6) : ''));
});

/* تقویم شمسی */
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const mDays = (y, m) => m <= 6 ? 31 : m <= 11 ? 30 : Core.validDate(`${y}/12/30`) ? 30 : 29;
const p2 = n => String(n).padStart(2, '0');
function jOrd(y, m, d) { // روز چندم از ۱۳۰۰/۰۱/۰۱
  let n = 0;
  for (let i = 1300; i < y; i++) n += Core.validDate(`${i}/12/30`) ? 366 : 365;
  for (let i = 1; i < m; i++) n += mDays(y, i);
  return n + d - 1;
}
const satIdx = (y, m, d) => { // شنبه = ۰
  const [ty, tm, td] = today().split('/').map(Number);
  return (((new Date().getDay() + 1) % 7 - jOrd(ty, tm, td) + jOrd(y, m, d)) % 7 + 7) % 7;
};
function openCal(input) {
  const v = normDate(input.value), [y, m] = (Core.validDate(v) ? v : today()).split('/').map(Number);
  S.cal = { input, y, m };
  let box = $('#cal');
  if (!box) { box = document.createElement('div'); box.id = 'cal'; document.body.append(box); }
  box.hidden = false; drawCal();
}
function closeCal() { const c = $('#cal'); if (c) { c.hidden = true; c.innerHTML = ''; } S.cal = null; }
function drawCal() {
  const { y, m, input } = S.cal, sel = normDate(input.value), now = today(), first = satIdx(y, m, 1);
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<span></span>';
  for (let d = 1; d <= mDays(y, m); d++) {
    const s = `${y}/${p2(m)}/${p2(d)}`;
    cells += `<button type="button" class="${s === sel ? 'on' : ''} ${s === now ? 'now' : ''}" data-act="calday" data-d="${s}">${fa(d)}</button>`;
  }
  $('#cal').innerHTML = `<div class="calbox" role="dialog" aria-label="تقویم">
    <div class="calhead"><button type="button" data-act="calmove" data-n="-1" aria-label="ماه قبل">›</button><b>${MONTHS[m - 1]} ${fa(y)}</b><button type="button" data-act="calmove" data-n="1" aria-label="ماه بعد">‹</button></div>
    <div class="calgrid wk">${['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="calgrid">${cells}</div>
    <div class="two"><button type="button" class="ghost" data-act="calday" data-d="${now}">امروز</button><button type="button" class="ghost" data-act="calclose">بستن</button></div></div>`;
}
const calActs = {
  cal(b) { openCal($('#' + b.dataset.for)); },
  calmove(b) { const c = S.cal; c.m += Number(b.dataset.n); if (c.m < 1) { c.m = 12; c.y--; } if (c.m > 12) { c.m = 1; c.y++; } if (c.y < 1300 || c.y > 1500) { c.y = Math.min(1500, Math.max(1300, c.y)); } drawCal(); },
  calday(b) { const el = S.cal.input; el.value = fa(b.dataset.d); el.dispatchEvent(new Event('change', { bubbles: true })); closeCal(); },
  calclose() { closeCal(); },
};

function showAuth(hasUser) {
  closeSheet();
  S.view = 'home';
  $('#tabs').hidden = true;
  S.shown = null;
  $('#view').innerHTML = `<form class="auth" id="lf" novalidate><div class="lockicon">${ICON.lock}</div>
    <h1>${hasUser ? 'خوش <b>برگشتید</b>' : 'شروع <b>حساب من</b>'}</h1>
    <p class="sub">${hasUser ? 'برای باز شدن حساب‌هایتان رمز را بزنید.' : 'اطلاعات فقط روی همین گوشی و رمزگذاری‌شده می‌ماند.'}</p>
    ${hasUser ? '' : '<p class="hint">این رمز اطلاعات را رمزگذاری می‌کند و حداقل ۶ حرف است. اگر فراموش شود، اطلاعات و پشتیبان‌ها باز نمی‌شوند و راه بازیابی ندارد.</p>'}
    <label for="p">رمز</label><div class="field">${ICON.lock}<input id="p" type="password" placeholder="••••••" autocomplete="${hasUser ? 'current-password' : 'new-password'}"><button type="button" class="eye" aria-label="نمایش رمز">${ICON.eye}</button></div>
    ${hasUser ? '' : `<label for="p2">تکرار رمز</label><div class="field">${ICON.lock}<input id="p2" type="password" placeholder="••••••" autocomplete="new-password"></div>`}
    <div class="err" id="err" role="alert"></div><button class="primary">${hasUser ? 'باز کردن' : 'شروع'}</button>
    ${hasUser ? '' : '<button type="button" class="ghost" data-act="restore">بازیابی از فایل پشتیبان</button>'}</form>`;
  $('#lf .eye').onclick = () => { for (const i of document.querySelectorAll('#lf input')) i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    if (!hasUser && $('#p').value !== $('#p2').value) return $('#err').textContent = 'دو رمز یکی نیستند.';
    try { await api('/api/auth/' + (hasUser ? 'login' : 'setup'), 'POST', { password: $('#p').value }); await refresh(); }
    catch (x) { $('#err').textContent = x.msg; }
  };
  if (hasUser) $('#p').focus();
}

async function saveFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (e) { if (e.name === 'AbortError') return false; throw e; }
  } else { const u = URL.createObjectURL(file), l = document.createElement('a'); l.href = u; l.download = file.name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
  return true;
}

function restoreForm() {
  openSheet(`<form id="rf" novalidate><div class="phead"><h1>بازیابی از فایل</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <p class="hint">اطلاعات فعلی این گوشی با فایل جایگزین می‌شود.</p>
    <label for="rfile">فایل پشتیبان</label><input id="rfile" type="file">
    <label for="rp">رمز زمان ساخت پشتیبان</label><input id="rp" type="password" autocomplete="off">
    <div class="err" id="rerr" role="alert"></div><button class="primary">بازیابی</button></form>`);
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    const f = $('#rfile').files[0];
    if (!f) return $('#rerr').textContent = 'فایل را انتخاب کنید.';
    if (!confirm('اطلاعات فعلی این گوشی جایگزین شود؟')) return;
    try { await Core.importBackup(await f.text(), $('#rp').value); closeSheet(); toast('بازیابی شد.'); await refresh(); }
    catch (x) { $('#rerr').textContent = x.msg || 'بازیابی انجام نشد.'; }
  };
}

/* ---------- آیکون و رنگ دسته‌ها ---------- */
const CAT_EMOJI = { 'حقوق': '💼', 'فروش': '🏷️', 'سایر درآمدها': '✨', 'خوراک': '🍔', 'رفت‌وآمد': '🚕', 'خانه': '🏠', 'قبض‌ها': '💡', 'درمان': '💊',
  'کارمزد بانکی': '🏦', 'سایر هزینه‌ها': '🧾', 'دریافت طلب': '🤝', 'دریافت قرض': '🤝', 'برگشت وجه': '↩️', 'سایر واریزها': '📥',
  'پرداخت بدهی': '🤝', 'پرداخت قرض': '🤝', 'برداشت شخصی': '👛', 'سایر برداشت‌ها': '📤' };
const CAT_WORDS = [[/خرید|سوپر|بقال|میوه|هایپر/, '🛒'], [/بنزین|سوخت|کارواش/, '⛽'], [/اجاره|رهن/, '🏠'], [/قسط|وام/, '📆'], [/پوشاک|لباس|کفش/, '👕'],
  [/تفریح|سینما|سفر|مسافرت/, '🎉'], [/هدیه|کادو/, '🎁'], [/آموزش|کتاب|کلاس|مدرسه|دانشگاه/, '📚'], [/موبایل|اینترنت|شارژ|تلفن/, '📱'],
  [/رستوران|کافه|غذا|نهار|ناهار|شام|صبحانه/, '🍽️'], [/ورزش|باشگاه/, '🏋️'], [/بچه|کودک/, '🧸'], [/حیوان|گربه|سگ/, '🐾'], [/مالیات|عوارض/, '🧾'],
  [/ماشین|خودرو|تعمیر|مکانیک/, '🔧'], [/پزشک|دکتر|دارو|بیمه/, '💊'], [/سود|سپرده/, '📈'], [/آرایش|آرایشگاه/, '💇'], [/خیریه|نذر/, '💝']];
function catEmoji(name, kind) {
  if (CAT_EMOJI[name]) return CAT_EMOJI[name];
  for (const [re, e] of CAT_WORDS) if (re.test(name ?? '')) return e;
  return kind === 'neutral' ? '⚖️' : kind === 'income' ? '💰' : '🧾';
}
const hue = s => { let h = 7; for (const ch of String(s ?? '')) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
/* سبک «اپل»: به‌جای ایموجی، نماد خطی روی مربع رنگی (اگر نمادی نباشد همان ایموجی) */
const appleSkin = () => /^apple/.test(document.documentElement.dataset.skin || '');
const modernSkin = () => /^modern/.test(document.documentElement.dataset.skin || '');
/* سبک‌هایی که به‌جای ایموجی نماد خطی دارند */
const luxeSkin = () => document.documentElement.dataset.skin === 'luxe';
const bloomSkin = () => document.documentElement.dataset.skin === 'bloom';
const lineSkin = () => appleSkin() || modernSkin() || luxeSkin() || bloomSkin();
const CS = (c, d) => [c, `<svg viewBox="0 0 24 24">${d}</svg>`];
const CAT_SVG = {
  '💼': CS('#34c759', '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>'),
  '🏷️': CS('#ff9500', '<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  '✨': CS('#ff9f0a', '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  '🍔': CS('#ff6b35', '<path d="M7 3v18M5 3v5a2 2 0 0 0 4 0V3M17 21V3c-2 1-3 4-3 7h3"/>'),
  '🍽️': CS('#a2845e', '<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M11 3.5v2M14 3.5v2"/>'),
  '🚕': CS('#5856d6', '<path d="M5 16.5V12l2-5h10l2 5v4.5M3.5 12h17v4.5h-17ZM7 19v-2.5M17 19v-2.5"/>'),
  '🏠': CS('#007aff', '<path d="M4 11 12 4l8 7v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1Z"/>'),
  '💡': CS('#ff9f0a', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>'),
  '💊': CS('#ff2d55', '<path d="M12 5v14M5 12h14"/>'),
  '🏦': CS('#8e8e93', '<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
  '🧾': CS('#8e8e93', '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6"/>'),
  '🤝': CS('#af52de', '<circle cx="9" cy="7.5" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.8 3 2.7 3 5"/>'),
  '↩️': CS('#30b0c7', '<path d="M9 5 4 10l5 5M4 10h10a5 5 0 0 1 0 10h-3"/>'),
  '📥': CS('#34c759', '<path d="M12 3v11M7 9l5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  '📤': CS('#ff9500', '<path d="M12 14V3M7 8l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  '👛': CS('#a2845e', '<path d="M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11M15 13.5h2"/>'),
  '🛒': CS('#ff9500', '<path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6.2"/><circle cx="10" cy="19.5" r="1"/><circle cx="17" cy="19.5" r="1"/>'),
  '⛽': CS('#30b0c7', '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M3.5 20h12M5 10h9M14 9l3.5 2.5V17a1.5 1.5 0 0 0 3 0V8.5L18 6"/>'),
  '📆': CS('#ff3b30', '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
  '👕': CS('#5ac8fa', '<path d="M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3a4 4 0 0 1-8 0Z"/>'),
  '🎉': CS('#ff2d55', '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5l-5.3 2.9 1.2-6-4.5-4.1 6-.7Z"/>'),
  '🎁': CS('#af52de', '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9S10.5 4.5 8.5 4.5a2 2 0 0 0 0 4.5M12 9s1.5-4.5 3.5-4.5a2 2 0 0 1 0 4.5"/>'),
  '📚': CS('#5856d6', '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13"/>'),
  '📱': CS('#007aff', '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  '🏋️': CS('#34c759', '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>'),
  '🧸': CS('#ff9f0a', '<circle cx="12" cy="12" r="8.5"/><path d="M9 14a3 3 0 0 0 6 0M9.5 10h.01M14.5 10h.01"/>'),
  '🐾': CS('#a2845e', '<path d="M12 13c-3 0-5 3-5 5 0 1.5 1.5 2 2.5 2s1.5-.5 2.5-.5 1.5.5 2.5.5 2.5-.5 2.5-2c0-2-2-5-5-5Z"/><circle cx="6.5" cy="10" r="1.6"/><circle cx="10" cy="6" r="1.6"/><circle cx="14" cy="6" r="1.6"/><circle cx="17.5" cy="10" r="1.6"/>'),
  '🔧': CS('#8e8e93', '<path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 1-3-3 1-3Z"/>'),
  '📈': CS('#34c759', '<path d="M4 19h16M5 15l5-5 4 4 6-7"/>'),
  '💇': CS('#ff2d55', '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>'),
  '💝': CS('#ff2d55', '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>'),
  '⚖️': CS('#8e8e93', '<path d="M12 4v16M8 20h8M5 8h14M5 8l-2.5 6a2.5 2.5 0 0 0 5 0ZM19 8l-2.5 6a2.5 2.5 0 0 0 5 0Z"/>'),
  '💰': CS('#34c759', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5"/>')
};
const catIcon = (name, kind) => {
  const e = catEmoji(name, kind), s = lineSkin() && CAT_SVG[e];
  return s ? `<i class="ci" style="--tile:${s[0]}" aria-hidden="true">${s[1]}</i>` : `<i class="ci" style="--h:${hue(name)}" aria-hidden="true">${e}</i>`;
};
function txIcon(t) {
  if (t.kind === 'transfer') return `<i class="ci tr" style="--h:205" aria-hidden="true">${lineSkin() ? ICON.transfer : '⇄'}</i>`;
  const c = S.home?.categories.find(x => x.id === t.categoryId);
  return catIcon(c?.name ?? t.categoryName, isNeutral(t) ? 'neutral' : t.kind);
}

/* ---------- نمودار دایره‌ای و روند ---------- */
const PAL = ['#3fb7ff', '#ff7a8a', '#ffcf6b', '#3ddc97', '#b28cff', '#ff9f5a'];
function donut(items, label, pal = PAL) {
  const total = items.reduce((s, x) => s + x.amount, 0); if (!total) return '';
  const r = 46, C = 2 * Math.PI * r; let off = 0;
  const top = items.slice(0, 5), rest = items.slice(5).reduce((s, x) => s + x.amount, 0);
  const parts = rest ? [...top, { name: null, amount: rest }] : top;
  const segs = parts.map((x, i) => {
    const len = C * x.amount / total;
    const s = `<circle class="s" r="${r}" cx="60" cy="60" stroke="${pal[i]}" stroke-dasharray="${Math.max(0.5, len - (parts.length > 1 ? 2 : 0)).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" style="--i:${i}" transform="rotate(-90 60 60)"/>`;
    off += len; return s;
  }).join('');
  const legend = parts.map((x, i) => `<li><i style="background:${pal[i]}"></i><span>${x.name ? catEmoji(x.name, 'expense') + ' ' + esc(x.name) : 'بقیه'}</span><b>${fa(Math.round(x.amount * 100 / total))}٪</b></li>`).join('');
  return `<div class="donutbox"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="سهم هر دسته"><circle class="bgc" r="${r}" cx="60" cy="60"/>${segs}
    <text x="60" y="55" text-anchor="middle" class="dl">${label}</text><text x="60" y="73" text-anchor="middle" class="dv">${money(total)}</text></svg><ul class="legend">${legend}</ul></div>`;
}
function trendChart(tr) {
  const max = Math.max(1, ...tr.flatMap(x => [x.income, x.expense]));
  return `<div class="card trend">${tr.map((x, i) => `<div class="tc"><div class="tb"><i class="in" style="height:${Math.round(x.income * 100 / max)}%;--i:${i}"></i><i class="ex" style="height:${Math.round(x.expense * 100 / max)}%;--i:${i}"></i></div><small>${MONTHS[Number(x.month.slice(5)) - 1]}</small></div>`).join('')}
    <div class="tl"><span><i class="in"></i>درآمد</span><span><i class="ex"></i>هزینه</span></div></div>`;
}
function ring(p, size = 64) {
  const r = 26, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, p || 0));
  return `<svg class="ring" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="rb"/>
    <circle cx="32" cy="32" r="${r}" class="rf ${v >= 1 ? 'full' : ''}" stroke-dasharray="${(C * v).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle">${fa(Math.floor(v * 100))}٪</text></svg>`;
}

/* ---------- کارت نکته‌ی این ماه ---------- */
function insightCard(h) {
  if (!h.expense) return '';
  const day = Number(h.today.slice(8)) || 1, lines = [];
  if (h.prevToDate) {
    const p = Math.round((h.expense - h.prevToDate) * 100 / h.prevToDate);
    lines.push(p < 0 ? `تا امروز <b class="pos">${fa(-p)}٪ کمتر</b> از همین موقع ماه قبل خرج کرده‌اید 👏`
      : p > 0 ? `تا امروز <b class="neg">${fa(p)}٪ بیشتر</b> از همین موقع ماه قبل خرج کرده‌اید` : 'خرج این ماه تا امروز مثل همین موقع ماه قبل است');
  }
  const top = h.cats?.[0];
  if (top) lines.push(`بیشترین خرج: ${catEmoji(top.name, 'expense')} ${esc(top.name)}`);
  lines.push(`میانگین خرج روزانه: <b class="amtx">${money(Math.round(h.expense / day))}</b> ${unitName()}`);
  return `<div class="card insight"><span class="bulb" aria-hidden="true">💡</span><div>${lines.map(l => `<p>${l}</p>`).join('')}</div></div>`;
}

/* ---------- فهرست به تفکیک روز ---------- */
const WDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
function dayLabel(d) {
  if (d === today()) return 'امروز';
  if (d === yesterday()) return 'دیروز';
  const [y, m, dd] = d.split('/').map(Number);
  if (!y || !m || !dd) return fa(d);
  return `${WDAYS[satIdx(y, m, dd)]} ${fa(dd)} ${MONTHS[m - 1]}${y !== Number(today().slice(0, 4)) ? ' ' + fa(y) : ''}`;
}
function byDay(rows, fn) {
  let out = '', cur = null, chunk = [];
  const flush = () => {
    if (!chunk.length) return;
    const sum = k => chunk.filter(t => t.kind === k && !isNeutral(t)).reduce((s, t) => s + t.amount, 0), inc = sum('income'), ex = sum('expense');
    out += `<div class="dayhead"><b>${dayLabel(cur)}</b><small>${inc ? `<span class="pos">+${money(inc)}</span>` : ''}${ex ? `<span class="neg">−${money(ex)}</span>` : ''}</small></div>` + chunk.map(fn).join('');
    chunk = [];
  };
  for (const t of rows) { if (t.date !== cur) { flush(); cur = t.date; } chunk.push(t); }
  flush();
  return out;
}

/* ---------- تیک ثبت موفق ---------- */
function done(text) {
  let d = $('#done');
  if (!d) { d = document.createElement('div'); d.id = 'done'; d.setAttribute('role', 'status'); document.body.append(d); }
  d.innerHTML = `<div><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg><b>${esc(text)}</b></div>`;
  d.hidden = false; d.classList.remove('go'); void d.offsetWidth; d.classList.add('go');
  clearTimeout(S.doneT); S.doneT = setTimeout(() => { d.hidden = true; }, 1300);
}

/* ---------- پنهان کردن مبلغ‌ها ---------- */
const masked = () => document.documentElement.classList.contains('mask');
document.documentElement.classList.toggle('mask', !!store.get('mask', false));

/* ---------- ماشین‌حساب در کادر مبلغ ---------- */
function fmtExpr(v) {
  let s = en(v).replace(/[*xX]/g, '×').replace(/\//g, '÷').replace(/-/g, '−').replace(/[^\d+−×÷]/g, '');
  s = s.replace(/^[+−×÷]+/, '').replace(/([+−×÷])[+−×÷]+/g, '$1');
  return s.split(/([+−×÷])/).map(p => /^\d+$/.test(p) ? fa(group(p.replace(/^0+(?=\d)/, ''))) : p).join(''); /* عدد به واحد نمایش */
}
function calcExpr(v) {
  const t = en(fmtExpr(v)).replace(/٬/g, '').replace(/[+−×÷]$/, '').split(/([+−×÷])/);
  if (!t[0]) return NaN;
  const st = [Number(t[0])], ops = [];
  for (let i = 1; i < t.length; i += 2) {
    const o = t[i], n = Number(t[i + 1]);
    if (o === '×') st[st.length - 1] *= n;
    else if (o === '÷') st[st.length - 1] = n ? st[st.length - 1] / n : NaN;
    else { ops.push(o); st.push(n); }
  }
  let r = st[0];
  ops.forEach((o, i) => { r = o === '+' ? r + st[i + 1] : r - st[i + 1]; });
  return Number.isFinite(r) ? Math.round(r) : NaN;
}
function showCalc() {
  const el = $('#calc'), v = $('#amt')?.value ?? ''; if (!el) return;
  const r = /[+−×÷]/.test(v) ? calcExpr(v) : NaN;
  el.textContent = r > 0 ? `= ${fa(group(r))} ${unitName()}` /* r به واحد نمایش است */ : /[+−×÷]/.test(v) && r <= 0 ? 'جمع باید بیشتر از صفر باشد' : '';
}

/* ---------- کشیدن ردیف به چپ: ویرایش و حذف ---------- */
const SWW = 150;
let swS = null, swAt = 0;
function closeSw(except) {
  document.querySelectorAll('.sw.open').forEach(x => { if (x !== except) { x.classList.remove('open'); x.querySelector('.item').style.transform = ''; x.style.setProperty('--p', 0); } });
}
function swGuard(e) {
  if (Date.now() - swAt < 350) { e.preventDefault(); return true; }
  if (document.querySelector('.sw.open') && !e.target.closest('.swa')) { closeSw(); e.preventDefault(); return true; }
  return false;
}
document.addEventListener('touchstart', e => {
  const el = e.target.closest?.('.sw');
  if (!el || e.target.closest('.swa')) { swS = null; return; }
  swS = { el, it: el.querySelector('.item'), x: e.touches[0].clientX, y: e.touches[0].clientY, base: el.classList.contains('open') ? -SWW : 0, v: null, lock: null };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!swS) return;
  const dx = e.touches[0].clientX - swS.x, dy = e.touches[0].clientY - swS.y;
  if (!swS.lock) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    swS.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (swS.lock === 'x') closeSw(swS.el);
  }
  if (swS.lock !== 'x') return;
  e.preventDefault();
  const v = Math.max(-SWW - 40, Math.min(0, swS.base + dx));
  swS.v = v; swS.el.classList.add('drag');
  swS.it.style.transform = `translateX(${v}px)`;
  swS.el.style.setProperty('--p', Math.min(1, -v / SWW).toFixed(2));
}, { passive: false });
document.addEventListener('touchend', () => {
  if (!swS) return;
  const s = swS; swS = null;
  if (s.lock !== 'x' || s.v == null) return;
  swAt = Date.now(); s.el.classList.remove('drag');
  const open = s.v < -SWW / 2;
  s.el.classList.toggle('open', open);
  s.it.style.transform = open ? `translateX(${-SWW}px)` : '';
  s.el.style.setProperty('--p', open ? 1 : 0);
});

/* ---------- هدف پس‌انداز ---------- */
function goalSheet(g) {
  openSheet(`<form id="gf" data-id="${g?.id ?? ''}" novalidate><div class="phead"><h1>${g ? esc(g.name) : 'هدف تازه'}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    ${g ? `<div class="goalhead">${ring(g.saved / g.target, 104)}<div><b>${money(g.saved)}</b> <span class="unit">از ${money(g.target)} ${unitName()}</span>
      <small>${g.saved >= g.target ? 'به هدف رسیدید 🎉' : `${money(g.target - g.saved)} ${unitName()} مانده`}</small></div></div>
      <label for="ga">مبلغ (${unitName()})</label><input id="ga" class="amount" inputmode="numeric" autocomplete="off">
      <div class="two"><button type="button" class="primary" data-act="gadd" data-s="1">افزودن به پس‌انداز</button><button type="button" class="ghost" data-act="gadd" data-s="-1">برداشت</button></div>
      <p class="hint">این بخش فقط پیشرفت هدف را می‌شمارد و پولی از حساب‌ها جابه‌جا نمی‌کند.</p>
      <details><summary>ویرایش یا حذف هدف</summary>` : ''}
    <label for="gn">نام هدف</label><input id="gn" autocomplete="off" placeholder="مثلاً خرید لپ‌تاپ" value="${esc(g?.name)}">
    <label for="gt">مبلغ هدف (${unitName()})</label><input id="gt" class="amount" inputmode="numeric" autocomplete="off" value="${g ? amtIn(g.target) : ''}">
    <div class="err" id="gerr" role="alert"></div><button class="${g ? 'ghost' : 'primary'}">${g ? 'ذخیره‌ی تغییر' : 'ساخت هدف'}</button>
    ${g ? `<button type="button" class="ghost danger" data-act="gdel" data-id="${g.id}">حذف هدف</button></details>` : ''}</form>`);
  for (const i of document.querySelectorAll('#gf .amount')) i.oninput = amtTyping;
  $('#gf').onsubmit = async e => {
    e.preventDefault();
    if (document.activeElement?.id === 'ga') return; // Enter در کادر مبلغ هدف را ویرایش نکند
    const body = { name: $('#gn').value.trim(), target: readAmt($('#gt').value) };
    if (Number.isNaN(body.target)) return $('#gerr').textContent = UNIT_ERR;
    try { await api(g ? '/api/goals/' + g.id : '/api/goals', g ? 'PUT' : 'POST', body); closeSheet(); done(g ? 'ذخیره شد' : 'هدف ساخته شد'); refresh(); }
    catch (x) { x.auth ? showAuth(true) : $('#gerr').textContent = x.msg; }
  };
  if (!g) $('#gn').focus();
}

/* اعلان با دکمه‌ی «برگرداندن» */
function toastUndo(text, fn) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span><button type="button" class="undo">برگرداندن</button>`;
  el.hidden = false; el.classList.add('withbtn');
  el.querySelector('.undo').onclick = () => { el.hidden = true; fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; el.classList.remove('withbtn'); }, 6000);
}

Object.assign(actions, {
  async fixcheck(b) {
    if (!confirm(b.textContent.trim() + '؟')) return;
    try { await api(`/api/accounts/${b.dataset.id}/fixcheck`, 'POST'); done('اختلاف صاف شد'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'ثبت نشد.'); }
  },
  recon(b) {
    const id = Number(b.dataset.id), app = Number(b.dataset.b);
    openSheet(`<form id="rcf" novalidate><div class="phead"><h1>تطبیق با موجودی بانک</h1><button type="button" class="x" data-act="close">بستن</button></div>
      <p class="hint">موجودی فعلی را از همراه‌بانک یا اپ بانک بخوانید و این‌جا بنویسید. اختلاف، اگر بانک کمتر باشد «کارمزد بانکی» و اگر بیشتر باشد «سایر درآمدها» با تاریخ امروز ثبت می‌شود. کارمزدهایی که پیامک ندارند این‌طوری صاف می‌شوند.</p>
      <div class="card"><small class="hint">موجودی در برنامه</small><div class="evamt amtx">${money(app)} <span class="unit">${unitName()}</span></div></div>
      <label for="rcb">موجودی واقعی بانک (${unitName()})</label><input id="rcb" class="amount" inputmode="numeric" autocomplete="off">
      <div id="rcd" class="calc"></div>
      <div class="err" id="rcerr" role="alert"></div><button class="primary">ثبت اختلاف</button></form>`);
    const read = () => readAmt($('#rcb').value);
    $('#rcb').oninput = e => {
      const dg = digits(e.target.value).replace(/^0+(?=\d)/, ''); e.target.value = dg ? fa(group(dg)) : ''; /* عدد به واحد نمایش */
      const df = read() - app;
      $('#rcd').innerHTML = !dg ? '' : Number.isNaN(df) ? UNIT_ERR : !df ? '✓ با بانک یکی است؛ اختلافی نیست.' : `اختلاف: <b class="${df < 0 ? 'neg' : 'pos'}">${df < 0 ? '−' : '+'}${money(Math.abs(df))}</b> ${unitName()} ← ${df < 0 ? 'کارمزد بانکی' : 'سایر درآمدها'}`;
    };
    $('#rcf').onsubmit = async e => {
      e.preventDefault();
      if (!digits($('#rcb').value)) return $('#rcerr').textContent = 'موجودی بانک را وارد کنید.';
      if (Number.isNaN(read())) return $('#rcerr').textContent = UNIT_ERR;
      try { await api(`/api/accounts/${id}/reconcile`, 'POST', { balance: read() }); closeSheet(); done('با بانک یکی شد'); refresh(); }
      catch (x) { x.auth ? showAuth(true) : $('#rcerr').textContent = x.msg; }
    };
    $('#rcb').focus();
  },
  /* ثبت آماده با یک لمس: همان لحظه با تاریخ امروز ثبت می‌شود */
  /* ثبت سریع: اول می‌پرسد (لمس ناخواسته چیزی ثبت نکند)، بعد با «ثبت» در tplok ثبت می‌شود */
  tplgo(b) {
    const t = (S.home.templates ?? []).find(x => x.id === Number(b.dataset.id)); if (!t) return;
    const acc = id => esc(S.home.accounts.find(a => a.id === id)?.name ?? '');
    const cat = S.home.categories.find(c => c.id === t.categoryId)?.name;
    const where = t.kind === 'transfer' ? `از ${acc(t.accountId)} به ${acc(t.toAccountId)}` : `${cat ? esc(cat) + ' · ' : ''}${t.kind === 'income' ? 'به' : 'از'} حساب ${acc(t.accountId)}`;
    const f = $('#fab'); if (f?.classList.contains('open')) actions.fab();
    openSheet(`<div class="phead"><h1>ثبت «${esc(t.name)}»؟</h1><button type="button" class="x" data-act="close">بستن</button></div>
      <div class="card tplask"><div class="evamt amtx ${t.kind === 'income' ? 'pos' : t.kind === 'expense' ? 'neg' : ''}">${money(t.amount)} <span class="unit">${unitName()}</span></div>
      <small class="hint">${KIND[t.kind]} · ${where} · امروز</small></div>
      <button type="button" class="primary" data-act="tplok" data-id="${t.id}">ثبت</button>
      <div class="two"><button type="button" class="ghost" data-act="tpl" data-id="${t.id}">تغییر مبلغ</button><button type="button" class="ghost" data-act="close">انصراف</button></div>`);
  },
  async tplok(b) {
    const t = (S.home.templates ?? []).find(x => x.id === Number(b.dataset.id)); if (!t || b.disabled) return;
    b.disabled = true; closeSheet();
    const tx = { kind: t.kind, amount: t.amount, accountId: t.accountId, toAccountId: t.toAccountId ?? null, categoryId: t.categoryId ?? null, personId: t.personId ?? null,
      description: t.description ?? null, method: t.method ?? null, notes: null, date: today(), clientId: uuid() };
    try {
      const r = await api('/api/transactions', 'POST', tx);
      done(t.name + ' ثبت شد');
      await refresh();
      toastUndo(`${t.name}: ${money(t.amount)} ${unitName()} ثبت شد.`, async () => {
        try { await api('/api/transactions/' + r.id, 'DELETE'); toast('برگردانده شد.'); refresh(); }
        catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'برگردانده نشد.'); }
      });
    } catch (e) { b.disabled = false; e.auth ? showAuth(true) : toast(e.msg || 'ثبت نشد.'); }
  },
  mask() { const on = !masked(); document.documentElement.classList.toggle('mask', on); store.set('mask', on); render(); },
  async swdel(b) {
    if (!confirm('این تراکنش حذف شود؟')) return closeSw();
    try { await api('/api/transactions/' + b.dataset.id, 'DELETE'); toast('حذف شد.'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'حذف نشد.'); }
  },
  goal(b) { goalSheet(b.dataset.id ? (S.home.goals ?? []).find(x => x.id === Number(b.dataset.id)) : null); },
  async gadd(b) {
    const id = Number($('#gf').dataset.id), a = readAmt($('#ga').value) * Number(b.dataset.s);
    if (Number.isNaN(a)) return $('#gerr').textContent = UNIT_ERR;
    if (!a) return $('#gerr').textContent = 'مبلغ را وارد کنید.';
    try {
      const r = await api(`/api/goals/${id}/add`, 'POST', { amount: a });
      closeSheet(); done(r.reached && a > 0 ? 'به هدف رسیدید 🎉' : a > 0 ? 'به پس‌انداز اضافه شد' : 'برداشت شد'); refresh();
    } catch (x) { x.auth ? showAuth(true) : $('#gerr').textContent = x.msg; }
  },
  async gdel(b) {
    if (!confirm('این هدف حذف شود؟')) return;
    try { await api('/api/goals/' + b.dataset.id, 'DELETE'); closeSheet(); toast('حذف شد.'); refresh(); }
    catch (x) { x.auth ? showAuth(true) : $('#gerr').textContent = x.msg; }
  },
});

/* ---------- رنگ برنامه ---------- */
const ACCENTS = [['blue', 'آبی', '#3fb7ff'], ['purple', 'بنفش', '#a878ff'], ['emerald', 'زمردی', '#2ecc96'], ['gold', 'طلایی', '#f5be46'], ['pink', 'صورتی', '#ff69aa']];
document.documentElement.dataset.accent = store.get('accent', 'blue');
const SKINS = [['classic', 'کلاسیک', '#05080f', 'linear-gradient(135deg,#0f2c55,#3fb7ff)'], ['liquid', 'شیشه‌ی مایع', '#0b0b1a', 'linear-gradient(135deg,#7b5cff,#ff5fa2,#22c1ee)'],
  ['neon', 'نئون', '#000000', 'linear-gradient(135deg,#00fff0,#ff00c8)'], ['gold', 'طلایی لوکس', '#070707', 'linear-gradient(135deg,#f8e6ba,#b8913f)'],
  ['light', 'روشن پاستلی', '#f3f1ff', 'linear-gradient(135deg,#d9d0ff,#ffd6e8,#cdeffd)'], ['aurora', 'رنگین', '#0a0614', 'linear-gradient(135deg,#f72585,#7209b7,#4361ee)'],
  ['apple', 'اپل روشن', '#f2f2f7', 'linear-gradient(135deg,#f2f2f7 55%,#007aff 55%)'], ['appledark', 'اپل تیره', '#000000', 'linear-gradient(135deg,#1c1c1e 55%,#0a84ff 55%)'],
  ['modern', 'بانک مدرن', '#4f46e5', 'linear-gradient(160deg,#4f46e5,#7c3aed 55%,#c026d3)'], ['luxe', 'طلایی شب', '#050505', 'linear-gradient(135deg,#050505 40%,#f5be46 75%,#7a5310)'], ['bloom', 'شکوفه', '#e9ecfb', 'linear-gradient(135deg,#eef0fb 35%,#1e3a8a 60%,#f9a8d4)'], ['moderndark', 'بانک مدرن تیره', '#0b0b10', 'radial-gradient(120% 90% at 85% 0,#6d28d9,transparent 70%),radial-gradient(80% 70% at 0 0,#2563eb,transparent 70%),#0b0b10']];
function setSkin(k) {
  const s = SKINS.find(x => x[0] === k) ?? SKINS[0];
  document.documentElement.dataset.skin = s[0];
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', s[2]);
}
setSkin(store.get('skin', 'classic'));

/* ---------- روزهای بدون خرج و حلقه‌های سقف ---------- */
function streakCard(h) {
  const n = h.noSpend; if (!n || !n.best) return '';
  return `<div class="card streak">${n.current ? `<span class="fire" aria-hidden="true">🔥</span><div><b>${fa(n.current)} روز</b> پشت سر هم بدون هزینه`
    : `<span class="fire" aria-hidden="true">🌱</span><div>امروز هزینه داشته‌اید؛ از فردا دوباره بشمارید`}<small>رکورد شما: ${fa(n.best)} روز${n.current && n.current >= n.best ? ' · رکورد تازه! 🎉' : ''}</small></div></div>`;
}
function budgetRings(h) {
  if (!h.budgetAll?.length) return '';
  return `<h2>سقف‌های این ماه</h2><div class="rings">${h.budgetAll.map(b => { const p = b.spent / b.budget;
    return `<div class="rg ${p > 1 ? 'over' : p >= 0.8 ? 'near' : ''}" data-act="report">${ring(p, 62)}<small>${catEmoji(b.name, 'expense')} ${esc(b.name)}</small>${p > 1 ? `<small class="neg">${fa(Math.round(p * 100))}٪</small>` : ''}</div>`; }).join('')}</div>`;
}
const monthName = ym => `${MONTHS[Number(ym.slice(5)) - 1]} ${fa(ym.slice(0, 4))}`;
function wrapBanner(h) {
  const day = Number(h.today.slice(8)), prev = prevMonth(h.today.slice(0, 7)), t = h.trend?.[h.trend.length - 2];
  if (day > 7 || store.get('wrapSeen', '') === prev || !t || !t.expense) return '';
  return `<button class="banner wrapb" data-act="wrap" data-m="${prev}">🎬 جمع‌بندی ${monthName(prev)} آماده است. ببینید!</button>`;
}

/* ---------- تقویم خرج ---------- */
function heatmap(r) {
  const [y, m] = r.month.split('/').map(Number), first = satIdx(y, m, 1), vals = Object.values(r.days ?? {}), max = Math.max(1, ...vals), now = today();
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<span></span>';
  for (let d = 1; d <= mDays(y, m); d++) {
    const s = `${y}/${p2(m)}/${p2(d)}`, v = r.days?.[s] ?? 0;
    cells += `<button type="button" class="hd ${v ? 'has' : ''} ${s === now ? 'now' : ''}" style="--a:${v ? (0.18 + 0.82 * v / max).toFixed(2) : 0}" data-act="heatday" data-d="${s}" aria-label="${fa(d)} ${MONTHS[m - 1]}: ${v ? money(v) + ' ' + unitName() : 'بدون خرج'}">${fa(d)}</button>`;
  }
  return `<div class="card heat"><div class="calgrid wk">${['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(w => `<span>${w}</span>`).join('')}</div><div class="calgrid">${cells}</div>
    <div class="hl"><span>کم</span><i style="--a:.2"></i><i style="--a:.5"></i><i style="--a:.8"></i><i style="--a:1"></i><span>زیاد</span></div></div>`;
}

/* ---------- استوری (جمع‌بندی ماه و سال) و کارت اشتراکی ---------- */
function playStory(slides, card) {
  let box = $('#story');
  if (!box) { box = document.createElement('div'); box.id = 'story'; document.body.append(box); }
  let i = 0, timer;
  const close = () => { clearTimeout(timer); box.hidden = true; box.innerHTML = ''; box.onclick = null; };
  const next = () => { if (i < slides.length - 1) { i++; draw(); } else close(); };
  const draw = () => {
    clearTimeout(timer);
    const [ic, title, sub] = slides[i];
    box.innerHTML = `<div class="sbars">${slides.map((_, k) => `<i class="${k < i ? 'full' : k === i ? 'run' : ''}"></i>`).join('')}</div>
      <button type="button" class="sx" aria-label="بستن">×</button>
      <div class="sl s${i % 5}"><div class="sic">${ic}</div><h1>${title}</h1><p>${sub}</p></div>
      <div class="sfoot"><button type="button" class="sshare">📤 ذخیره‌ی کارت</button><span class="shint">${i < slides.length - 1 ? 'برای بعدی لمس کنید' : 'برای بستن لمس کنید'}</span></div>`;
    box.querySelector('.sx').onclick = e => { e.stopPropagation(); close(); };
    box.querySelector('.sshare').onclick = async e => {
      e.stopPropagation(); clearTimeout(timer); box.querySelector('.sbars .run')?.classList.add('paused');
      try { await shareCard(card); } catch { toast('کارت ساخته نشد.'); }
    };
    timer = setTimeout(next, 4500);
  };
  box.onclick = e => { if (e.clientX > innerWidth * 0.72 && i > 0) { i--; draw(); } else next(); };
  box.hidden = false; draw();
}
async function shareCard(card) {
  const withAmt = confirm('مبلغ‌ها هم روی کارت باشند؟\n«لغو» = فقط دسته‌ها و درصدها');
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const x = c.getContext('2d'), acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim().split(/\s+/).join(',');
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, `rgb(${acc})`); g.addColorStop(0.5, '#0f1830'); g.addColorStop(1, '#05080f');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  const glow = x.createRadialGradient(880, 160, 10, 880, 160, 520); glow.addColorStop(0, 'rgba(255,255,255,.22)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = glow; x.fillRect(0, 0, 1080, 1350);
  const F = (w, s) => `${w} ${s}px -apple-system, "SF Arabic", system-ui, Tahoma, sans-serif`;
  const box = (y, h) => { x.fillStyle = 'rgba(255,255,255,.09)'; x.beginPath(); if (x.roundRect) x.roundRect(80, y, 920, h, 36); else x.rect(80, y, 920, h); x.fill(); };
  x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = '#fff';
  x.font = F(800, 70); x.fillText(card.title, 1000, 175);
  x.font = F(400, 34); x.globalAlpha = 0.7; x.fillText(card.sub, 1000, 238); x.globalAlpha = 1;
  let y = 300;
  for (const [ic, label, val, isAmt] of card.rows.filter(r => withAmt || !r[3]).slice(0, 6)) {
    box(y, 140);
    x.fillStyle = '#fff'; x.font = F(400, 62); x.fillText(ic, 975, y + 92);
    x.font = F(400, 32); x.globalAlpha = 0.72; x.fillText(label, 870, y + 55); x.globalAlpha = 1;
    x.font = F(800, 46); x.fillText(val, 870, y + 112);
    y += 160;
  }
  x.font = F(700, 30); x.globalAlpha = 0.6; x.textAlign = 'left'; x.fillText('حساب من ✨', 80, 1300); x.globalAlpha = 1;
  const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('blob');
  if (await saveFile(new File([blob], `hesab-${card.file}.png`, { type: 'image/png' }))) toast('کارت ساخته شد.');
}
async function showWrap(ym) {
  let r;
  try { r = await api('/api/report?month=' + encodeURIComponent(ym)); } catch (e) { return e.auth ? showAuth(true) : toast(e.msg || 'باز نشد.'); }
  if (!r.count) return toast('برای این ماه هزینه‌ای ثبت نشده است.');
  const wd = Array(7).fill(0);
  for (const [d, v] of Object.entries(r.days)) { const [y, m, dd] = d.split('/').map(Number); wd[satIdx(y, m, dd)] += v; }
  const topW = wd.indexOf(Math.max(...wd)), top = r.expenses[0], share = top && r.expense > 0 ? Math.round(top.amount * 100 / r.expense) : 0;
  const pct = r.prevExpense ? Math.round((r.expense - r.prevExpense) * 100 / r.prevExpense) : null, net = r.income - r.expense;
  const pctText = pct == null ? null : pct < 0 ? `${fa(-pct)}٪ کمتر از ماه قبل` : pct > 0 ? `${fa(pct)}٪ بیشتر از ماه قبل` : 'مثل ماه قبل';
  playStory([
    ['🎬', `جمع‌بندی ${monthName(r.month)}`, 'بیایید ببینیم این ماه چه گذشت…'],
    ['🧾', `${fa(r.count)} بار خرج کردید`, `در کل <b class="amtx">${money(r.expense)}</b> ${unitName()}`],
    top && ['🏆', `بیشترین خرج: ${catEmoji(top.name, 'expense')} ${esc(top.name)}`, `<b class="amtx">${money(top.amount)}</b> ${unitName()} · ${fa(share)}٪ کل خرج`],
    ['📅', `پرخرج‌ترین روز هفته: ${WDAYS[topW]}‌ها`, `<b class="amtx">${money(wd[topW])}</b> ${unitName()} در ${WDAYS[topW]}‌های این ماه`],
    r.biggest && ['💸', 'بزرگ‌ترین خرج یک‌جا', `${esc(r.biggest.description)}<br><b class="amtx">${money(r.biggest.amount)}</b> ${unitName()} · ${fa(r.biggest.date)}`],
    pct != null && (pct < 0 ? ['🎉', pctText + '!', 'آفرین، خرجتان کمتر شده.'] : pct > 0 ? ['📈', pctText, 'ماه بعد را با سقف خرج کنترل کنید.'] : ['⚖️', 'درست مثل ماه قبل', 'خرجتان ثابت مانده.']),
    [net >= 0 ? '💚' : '🧡', net >= 0 ? 'ماه را با پس‌انداز تمام کردید' : 'خرج از درآمد بیشتر شد', `خالص ماه: <b class="amtx ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</b> ${unitName()}`],
  ].filter(Boolean), {
    title: `جمع‌بندی ${monthName(r.month)}`, sub: 'حساب من', file: r.month.replace('/', '-'), rows: [
      ['🧾', 'تعداد خرج', `${fa(r.count)} بار`, false],
      ['💰', 'کل خرج', `${money(r.expense)} ${unitName()}`, true],
      top && ['🏆', 'بیشترین خرج', `${top.name} · ${fa(share)}٪`, false],
      ['📅', 'پرخرج‌ترین روز هفته', `${WDAYS[topW]}‌ها`, false],
      pctText && ['📊', 'نسبت به ماه قبل', pctText, false],
      ['💚', 'خالص ماه', `${net >= 0 ? '+' : '−'}${money(Math.abs(net))} ${unitName()}`, true],
    ].filter(Boolean),
  });
}
async function showYear(y) {
  let r;
  try { r = await api('/api/year?y=' + encodeURIComponent(y)); } catch (e) { return e.auth ? showAuth(true) : toast(e.msg || 'باز نشد.'); }
  if (!r.count && !r.income) return toast('برای این سال چیزی ثبت نشده است.');
  const used = r.months.filter(m => m.expense > 0), net = r.income - r.expense;
  const hi = used.reduce((a, b) => (b.expense > (a?.expense ?? -1) ? b : a), null), lo = used.reduce((a, b) => (b.expense < (a?.expense ?? Infinity) ? b : a), null);
  const top = r.top.map((t, i) => `${['🥇', '🥈', '🥉'][i]} ${catEmoji(t.name, 'expense')} ${esc(t.name)}`).join('<br>');
  playStory([
    ['📆', `سال ${fa(r.year)} شما`, 'یک سال حساب‌وکتاب در چند کارت'],
    ['🧾', `${fa(r.count)} خرج ثبت کردید`, `در کل <b class="amtx">${money(r.expense)}</b> ${unitName()}`],
    r.top.length && ['🏆', 'پرخرج‌ترین دسته‌ها', top],
    hi && ['🔥', `پرخرج‌ترین ماه: ${MONTHS[Number(hi.month.slice(5)) - 1]}`, `<b class="amtx">${money(hi.expense)}</b> ${unitName()}`],
    lo && lo !== hi && ['🌿', `کم‌خرج‌ترین ماه: ${MONTHS[Number(lo.month.slice(5)) - 1]}`, `<b class="amtx">${money(lo.expense)}</b> ${unitName()}`],
    r.biggest && ['💸', 'بزرگ‌ترین خرج سال', `${esc(r.biggest.description)}<br><b class="amtx">${money(r.biggest.amount)}</b> ${unitName()}`],
    [net >= 0 ? '💚' : '🧡', net >= 0 ? 'سال را با پس‌انداز تمام کردید' : 'خرج سال از درآمد بیشتر شد', `درآمد <b class="amtx">${money(r.income)}</b><br>خالص: <b class="amtx ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</b> ${unitName()}`],
  ].filter(Boolean), {
    title: `سال ${fa(r.year)} من`, sub: 'حساب من', file: String(r.year), rows: [
      ['🧾', 'تعداد خرج', `${fa(r.count)} بار`, false],
      ['💰', 'کل خرج', `${money(r.expense)} ${unitName()}`, true],
      r.top[0] && ['🏆', 'پرخرج‌ترین دسته', r.top[0].name, false],
      hi && ['🔥', 'پرخرج‌ترین ماه', MONTHS[Number(hi.month.slice(5)) - 1], false],
      lo && ['🌿', 'کم‌خرج‌ترین ماه', MONTHS[Number(lo.month.slice(5)) - 1], false],
      ['💚', 'خالص سال', `${net >= 0 ? '+' : '−'}${money(Math.abs(net))} ${unitName()}`, true],
    ].filter(Boolean),
  });
}

/* ---------- دنگ ---------- */
function splitShares() {
  const sel = [...document.querySelectorAll('#splitp .on')].map(b => Number(b.dataset.id));
  if (!sel.length) return null;
  const total = Core.unit.parse(calcExpr($('#amt').value), UNIT); if (!(total > 0)) return { shares: [], total: 0 };
  const me = $('#splitme')?.checked, n = sel.length + (me ? 1 : 0), each = Math.floor(total / n);
  const shares = sel.map(personId => ({ personId, amount: each }));
  if (!me) shares[shares.length - 1].amount += total - each * sel.length; // باقی‌مانده‌ی تقسیم به آخرین نفر
  return { shares, total, own: me ? total - each * sel.length : 0 };
}
function updateSplit() {
  const el = $('#splitv'); if (!el) return;
  const sp = splitShares();
  el.innerHTML = !sp ? '' : !sp.total ? 'اول مبلغ را وارد کنید.'
    : `هر نفر <b>${money(sp.shares[0].amount)}</b> ${unitName()}${sp.own ? ` · سهم شما <b>${money(sp.own)}</b>` : ''} · طلب شما: <b>${money(sp.total - sp.own)}</b> ${unitName()}`;
}

/* ---------- عکس رسید ---------- */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const k = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.7, 0.55, 0.42, 0.3]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 560000) return d; }
    throw new Error('big');
  } finally { URL.revokeObjectURL(url); }
}
function showPhoto(data) {
  const v = $('#phv'); if (!v) return;
  v.innerHTML = data ? `<img src="${data}" alt="عکس رسید" class="thumb"><button type="button" class="chip" data-act="phdel">حذف عکس</button>` : '';
  const im = v.querySelector('img'); if (im) im.onclick = () => im.classList.toggle('big');
}
async function savePhoto(id) {
  if (!id || S.fphoto === undefined) return;
  try { await api(`/api/transactions/${id}/photo`, 'PUT', { data: S.fphoto }); }
  catch (e) { toast('عکس ذخیره نشد: ' + (e.msg || '')); }
}

Object.assign(actions, {
  accent(b) { document.documentElement.dataset.accent = b.dataset.k; store.set('accent', b.dataset.k); render(); },
  skin(b) { setSkin(b.dataset.k); store.set('skin', b.dataset.k); render(); },
  unit(b) { UNIT = b.dataset.k === 'rial' ? 'rial' : 'toman'; store.set('unit', UNIT); render(); },
  wrap(b) { if (b.classList.contains('wrapb')) store.set('wrapSeen', b.dataset.m); showWrap(b.dataset.m || S.month); if (b.classList.contains('wrapb')) b.remove(); },
  heatday(b) { S.filter = { from: b.dataset.d, to: b.dataset.d }; S.view = 'list'; render(); window.scrollTo(0, 0); },
  splitp(b) { b.classList.toggle('on'); updateSplit(); },
  photo() { $('#phf').click(); },
  phdel() { S.fphoto = null; showPhoto(null); },
});

/* ---------- کارت بانکی برای هر حساب ---------- */
const BANKS = [[/ملت/, '#d4202a', '#6e0c16'], [/ملی/, '#1f4fa8', '#0a2152'], [/صادرات/, '#2563b0', '#0d2a57'], [/تجارت/, '#1767b3', '#082b52'],
  [/سپه/, '#d99a14', '#6b4300'], [/پاسارگاد/, '#e2b12a', '#2e2300'], [/سامان/, '#2f7fd1', '#0f3a6b'], [/پارسیان/, '#a3214a', '#45081c'],
  [/رسالت/, '#14a3a3', '#05424a'], [/مسکن/, '#f07a1a', '#6e2e00'], [/کشاورزی/, '#1f8a5a', '#08371f'], [/رفاه/, '#2a86e0', '#0c366b'],
  [/آینده/, '#7b3fa8', '#2e1047'], [/اقتصاد ?نوین/, '#7a2a9c', '#2d0d40'], [/شهر/, '#d22b3c', '#540b14'], [/سینا/, '#1b6aa8', '#092c4a'],
  [/(^|\s)دی(\s|$)/, '#1aa38a', '#06443a'], [/بلو/, '#2f6fe0', '#0f2a63'], [/توسعه/, '#3a7bd5', '#0f2f5f'], [/قرض.?الحسنه/, '#0f9d58', '#053f22']];
/* چهارتایی جدا (شماره کارت و شبا با رقم لاتین، مثل روی کارت) */
const grp4 = v => v ? String(v).replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ') : '';
const NFC = '<svg class="nfc" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a7 7 0 0 1 0 10M12 5a10 10 0 0 1 0 14M16 3a13 13 0 0 1 0 18"/></svg>';
const SV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I_FLIP = SV('M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4');
const I_COPY = SV('M8 8h12v12H8ZM16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8');
const I_SHARE = SV('M12 3v12M7 8l5-5 5 5M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6');
const bankNums = a => [['شماره کارت', a.cardNumber], ['شماره حساب', a.accountNumber && en(a.accountNumber)], ['شبا', a.iban]].filter(x => x[1]);
function bankCard(a) {
  const key = `${a.bankName || ''} ${a.name}`, hit = BANKS.find(([re]) => re.test(key)), h = hue(key), bank = a.kind === 'bank';
  const [c1, c2] = !bank ? ['#9a6a33', '#3a220c'] : hit ? [hit[1], hit[2]] : [`hsl(${h} 60% 45%)`, `hsl(${h} 60% 16%)`];
  const title = bank ? esc(a.bankName || 'بانک') : 'نقد', logo = esc([...(bank ? (a.bankName || a.name || 'ب') : 'ن')][0]);
  const nums = bank ? bankNums(a) : [], cn = a.cardNumber;
  const shown = cn ? `${cn.slice(0, 4)} ${cn.slice(4, 8)} •••• ${cn.slice(12)}` : a.accountNumber ? grp4(en(a.accountNumber)) : '';
  const flip = nums.length ? `<button type="button" class="bfl" data-act="bflip" aria-label="پشت کارت">${I_FLIP}</button>` : '';
  return `<div class="bcard ${a.kind}" role="button" tabindex="0" data-act="stmt" data-id="${a.id}" style="--c1:${c1};--c2:${c2}">
    <div class="bf front"><span class="bt"><span class="bk"><i class="blg">${logo}</i><b>${title}</b></span>${flip}</span>
      ${bank ? `<span class="bmid"><i class="chipg" aria-hidden="true"></i>${NFC}</span>` : '<span class="bmid"><i class="wal" aria-hidden="true">👛</i></span>'}
      <span class="bnum">${shown ? esc(shown) : !bank ? 'کیف پول' : ''}</span>
      <span class="bbot"><span><small>حساب</small><b>${esc(a.name)}${a.business ? ' <small class="bizt">کسب‌وکار</small>' : ''}</b></span>
      <span class="bal ${a.balance < 0 ? 'neg' : ''}"><small>موجودی</small>${money(a.balance)} <small>${unitName()}</small></span></span></div>
    ${nums.length ? `<div class="bf back"><span class="bt"><span class="bk"><b>${title}</b></span><span class="bacts">
      <button type="button" data-act="bshare" aria-label="فرستادن">${I_SHARE}</button><button type="button" data-act="bcopyall" aria-label="کپی همه">${I_COPY}</button>${flip}</span></span>
      <i class="stripe" aria-hidden="true"></i>
      ${nums.map(([k, v]) => `<span class="brow"><small>${k}</small><code>${esc(grp4(v))}</code><button type="button" data-act="bcopy" data-v="${esc(v)}" aria-label="کپی ${k}">${I_COPY}</button></span>`).join('')}</div>` : ''}</div>`;
}
function bankShareText(a) { return [`${a.bankName || ''} - ${a.name}`.replace(/^ - /, ''), ...bankNums(a).map(([k, v]) => `${k}: ${grp4(v)}`)].join('\n'); }
async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast('کپی نشد؛ دستی انتخاب کنید.'); }
}

/* ---------- نمودار موجودی زیر کارت خانه ---------- */
function spark(series, smooth) {
  if (!series?.length) return '';
  const n = store.get('sparkN', 30), pts = series.slice(-n), vals = pts.map(p => p.total);
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 300, H = 56;
  const X = i => (i * W / Math.max(1, pts.length - 1)).toFixed(1), Y = v => (hi === lo ? H / 2 : 6 + (H - 12) * (1 - (v - lo) / (hi - lo))).toFixed(1);
  /* smooth: خط نرم با منحنی بین نقطه‌ها (سبک بانک مدرن) */
  const line = smooth && vals.length > 2 ? vals.map((v, i) => !i ? `M${X(0)} ${Y(v)}` : `Q${X(i - 1)} ${Y(vals[i - 1])} ${((+X(i - 1) + +X(i)) / 2).toFixed(1)} ${((+Y(vals[i - 1]) + +Y(v)) / 2).toFixed(1)}`).join(' ') + ` L${X(vals.length - 1)} ${Y(vals[vals.length - 1])}`
    : vals.map((v, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(v)}`).join(' '), diff = vals[vals.length - 1] - vals[0];
  return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" style="stop-color:rgb(var(--acct));stop-opacity:.42"/><stop offset="1" style="stop-color:rgb(var(--acct));stop-opacity:0"/></linearGradient></defs>
    <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#sg)"/><path d="${line}" class="spl"/></svg>
    <div class="spk"><span class="${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} <b class="amtx">${money(Math.abs(diff))}</b> در ${fa(n)} روز</span>
    <span><button type="button" class="${n === 30 ? 'on' : ''}" data-act="spark" data-n="30">۳۰ روز</button><button type="button" class="${n === 90 ? 'on' : ''}" data-act="spark" data-n="90">۹۰ روز</button></span></div></div>`;
}

/* ---------- خرج‌های تکراری ---------- */
function subsCard(h) {
  const s = (h.subs ?? []).slice(0, 2); if (!s.length) return '';
  return `<h2>خرج تکراری پیدا شد</h2>${s.map(x => `<div class="card subc"><div class="subt">${catIcon(h.categories.find(c => c.id === x.categoryId)?.name, 'expense')}
    <div><b>${esc(x.name)}</b><small>${fa(x.months)} ماه اخیر، حدود <span class="amtx">${money(x.amount)}</span> ${unitName()} در ماه</small></div></div>
    <p class="hint">به «پرداخت‌های ماهانه» اضافه شود تا سررسید بعدی (${fa(x.next)}) در خانه یادآوری شود؟</p>
    <div class="two"><button class="primary" data-act="subadd" data-k="${esc(x.key)}">افزودن</button><button class="ghost" data-act="subno" data-k="${esc(x.key)}">لازم نیست</button></div></div>`).join('')}`;
}

/* ---------- نشان‌ها ---------- */
function badgesHtml() {
  const b = S.home.badges ?? [];
  return `<h2>نشان‌ها (${fa(b.filter(x => x.got).length)} از ${fa(b.length)})</h2><div class="badges">${b.map(x => `<div class="bdg ${x.got ? 'got' : ''}"><span>${x.got ? x.icon : '🔒'}</span><b>${x.name}</b><small>${x.desc}</small></div>`).join('')}</div>`;
}
function checkBadges() {
  const all = S.home?.badges; if (!all) return;
  const got = all.filter(b => b.got).map(b => b.k), seen = store.get('badgesSeen', null);
  if (seen === null) { store.set('badgesSeen', got); return; } // بار اول بی‌سروصدا
  const fresh = got.filter(k => !seen.includes(k));
  if (!fresh.length) return;
  store.set('badgesSeen', [...seen, ...fresh]);
  setTimeout(() => celebrate(all.find(b => b.k === fresh[0])), 700);
}
function celebrate(b) {
  const el = document.createElement('div'); el.id = 'confetti'; el.setAttribute('role', 'status');
  const colors = ['#ffcf6b', '#ff7a8a', '#3ddc97', '#a878ff', '#ffffff', getComputedStyle(document.documentElement).getPropertyValue('--brand')];
  let bits = '';
  for (let i = 0; i < 70; i++) bits += `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.6).toFixed(2)}s;animation-duration:${(2 + Math.random() * 1.4).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--x:${Math.round(Math.random() * 120 - 60)}px"></i>`;
  el.innerHTML = `${bits}<div class="cbox"><span>${b.icon}</span><small>نشان تازه گرفتید!</small><b>${b.name}</b><p>${b.desc}</p></div>`;
  el.onclick = () => el.remove();
  document.body.append(el);
  setTimeout(() => el.remove(), 3600);
}

/* ---------- دکمه‌ی شناور «+» ---------- */
(() => {
  const f = document.createElement('div'); f.id = 'fab';
  f.innerHTML = '<button type="button" class="fabb" data-act="fab" aria-label="ثبت تازه" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>';
  const m = document.createElement('div'); m.id = 'fabm'; m.hidden = true;
  $('#tabs').after(m, f);
})();
/* هر لمسی بیرون از دکمه‌ی «+» منو را می‌بندد (کار دکمه‌ی لمس‌شده بعدش انجام می‌شود) */
document.addEventListener('click', e => { if (!e.target.closest?.('.fabb')) { const f = $('#fab'); if (f?.classList.contains('open')) { f.classList.remove('open'); $('#fabm').hidden = true; f.querySelector('.fabb').setAttribute('aria-expanded', 'false'); } } }, true);

Object.assign(actions, {
  /* منوی «+»: کارت پایین صفحه با سه کار اصلی، پیامک بانک و عکس رسید، و ثبت‌های آماده */
  fab() {
    const f = $('#fab'), m = $('#fabm'), open = !f.classList.contains('open');
    if (open) {
      const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
      const tp = (S.home?.templates ?? []).slice(0, 6).map(t => `<button type="button" class="fmt" data-act="tplgo" data-id="${t.id}"><b>${esc(t.name)}</b><small class="amtx">${money(t.amount)}</small></button>`).join('');
      m.innerHTML = `<div class="fmcard" role="menu">
        <div class="fmmain">
          <button type="button" class="fmb" data-act="new" data-k="expense"><i class="fmi out">${ic('M12 19V5M6 11l6-6 6 6')}</i>هزینه</button>
          <button type="button" class="fmb" data-act="new" data-k="income"><i class="fmi in">${ic('M12 5v14M6 13l6 6 6-6')}</i>درآمد</button>
          <button type="button" class="fmb" data-act="new" data-k="transfer"><i class="fmi tr">${ic('M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4')}</i>انتقال</button></div>
        <div class="fmsub"><button type="button" data-act="inbox">${ic('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5Z')}پیامک بانک</button>
          <button type="button" data-act="receipt">${ic('M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z')}عکس رسید</button></div>
        ${tp ? `<div class="fmsep"><span>ثبت سریع</span></div><div class="fmtpl">${tp}</div>` : ''}</div>`;
    }
    m.hidden = !open; f.classList.toggle('open', open); f.querySelector('.fabb').setAttribute('aria-expanded', String(open));
  },
  spark(b) { store.set('sparkN', Number(b.dataset.n)); render(); },
  bloomn(b) { store.set('bloomN', Number(b.dataset.n)); render(); },
  receipt() { txForm('expense'); $('#phf')?.click(); },
  avatar() {
    if (!store.get('avatar', null)) return avatarPick();
    openSheet(`<div class="phead"><h1>عکس پروفایل</h1><button type="button" class="x" data-act="close">بستن</button></div>
      <div class="avbig"><img src="${esc(store.get('avatar', ''))}" alt=""></div>
      <button type="button" class="primary" data-act="avpick">عوض کردن عکس</button><button type="button" class="ghost" data-act="avdel">حذف عکس</button>
      <p class="hint">عکس فقط روی همین گوشی می‌ماند و در فایل پشتیبان نمی‌رود.</p>`);
  },
  avpick() { avatarPick(); },
  avdel() { store.del('avatar'); closeSheet(); render(); toast('عکس پروفایل حذف شد.'); },
  biz(b) { store.set('noBiz', b.dataset.v === '1'); render(); },
  async subadd(b) {
    const x = (S.home.subs ?? []).find(s => s.key === b.dataset.k); if (!x) return;
    try { await api('/api/recurring', 'POST', { name: x.name, kind: 'expense', amount: x.amount, categoryId: x.categoryId, accountId: x.accountId, personId: null, next: x.next, left: null });
      done('به ماهانه اضافه شد'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'اضافه نشد.'); }
  },
  async subno(b) { try { await api('/api/subs/hide', 'POST', { key: b.dataset.k }); refresh(); } catch (e) { e.auth ? showAuth(true) : toast(e.msg); } },
  async remind(b) {
    const text = `سلام ${b.dataset.n} عزیز، وقت بخیر 🌷\nطبق حساب من، مبلغ ${money(Number(b.dataset.b))} ${unitName()} از شما طلب دارم.\nهر وقت برایتان مقدور بود، ممنون می‌شوم تسویه کنید. 🙏`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('متن یادآوری کپی شد.'); }
    } catch (e) { if (e.name !== 'AbortError') toast('ارسال نشد.'); }
  },
  wrap(b) { if (b.classList.contains('wrapb')) { store.set('wrapSeen', b.dataset.m); b.remove(); } showWrap(b.dataset.m || S.month); },
  year(b) { showYear(b.dataset.y); },
});

/* نسخه‌ی تازه (فقط وب): در پس‌زمینه گرفته می‌شود و با زدن دکمه جایگزین می‌شود؛ اطلاعات دست نمی‌خورد. */
const VERSION = 'v36';
const Upd = { reg: null, go: false, at: 0 };
function showUpdate() {
  if ($('#upd')) return;
  document.body.insertAdjacentHTML('beforeend', '<button id="upd" data-act="update">نسخه‌ی تازه آماده است؛ برای به‌روزرسانی بزنید</button>');
}
async function watchUpdate() {
  if (window.HesabAndroid || !('serviceWorker' in navigator) || !isSecureContext) return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', () => { if (Upd.go) location.reload(); });
  try {
    const reg = Upd.reg = await sw.register('sw.js', { updateViaCache: 'none' });
    const ready = () => { if (reg.waiting && sw.controller) showUpdate(); };
    const follow = w => w?.addEventListener('statechange', ready);
    reg.addEventListener('updatefound', () => follow(reg.installing));
    follow(reg.installing); ready();
    Upd.at = Date.now();
  } catch { }
}
/* هر بار برگشتن به برنامه، حداکثر هر ۱۵ دقیقه */
function checkUpdate(now) {
  if (!Upd.reg || (!now && Date.now() - Upd.at < 15 * 60e3)) return;
  Upd.at = Date.now();
  return Upd.reg.update().catch(() => { });
}
Object.assign(actions, {
  update(b) { const w = Upd.reg?.waiting; if (!w) return location.reload(); Upd.go = true; b.disabled = true; b.textContent = 'در حال به‌روزرسانی…'; w.postMessage('update'); },
  async checkupd() { toast('در حال بررسی…'); await checkUpdate(true); setTimeout(() => { if (!$('#upd')) toast(Upd.reg?.installing ? 'نسخه‌ی تازه در حال دریافت است.' : 'نسخه‌ی تازه‌ای نیست.'); }, 2500); },
});

async function boot() {
  watchUpdate();
  try {
    const st = await api('/api/auth/state');
    if (!st.hasUser) return showAuth(false);
    if (!st.loggedIn) return showAuth(true);
    await refresh();
  } catch {
    if (S.home) render();
    else $('#view').innerHTML = '<div class="card empty">برنامه باز نشد؛ دوباره امتحان کنید.</div>';
  }
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkUpdate();
  if (document.hidden) hiddenAt = Date.now();
  else if (S.home && Date.now() - hiddenAt > 5 * 60e3) { Core.lock(); S.home = null; showAuth(true); } // قفل خودکار بعد از ۵ دقیقه
});
boot();
