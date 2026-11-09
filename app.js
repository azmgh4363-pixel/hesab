'use strict';
const $ = (s, r = document) => r.querySelector(s);
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
const fa = v => String(v).replace(/\d/g, d => FA[d]);
const en = v => String(v).replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => AR.indexOf(d));
const group = n => String(n).replace(/\B(?=(\d{3})+$)/g, '٬');
const money = n => (n < 0 ? '−' : '') + fa(group(Math.abs(n)));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = v => en(v).replace(/\D/g, '');
const KIND = { income: 'درآمد', expense: 'هزینه', transfer: 'انتقال' };
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
  const el = $('#toast'); el.textContent = t; el.hidden = false;
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
  if (S.view === 'home') { const tot = S.home.cash + S.home.bank; if (entering) countUp(0); else if (S.shownTotal != null && S.shownTotal !== tot) countUp(S.shownTotal); S.shownTotal = tot; }
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
  const sign = into ? 'pos' : out ? 'neg' : '';
  const acc = S.home.accounts, nameOf = id => acc.find(a => a.id === id)?.name ?? '';
  const cat = S.home.categories.find(c => c.id === t.categoryId)?.name;
  const title = t.description || t.categoryName || cat || KIND[t.kind];
  const sub = (t.kind === 'transfer' ? `${t.accountName ?? nameOf(t.accountId)} ← ${t.toAccountName ?? nameOf(t.toAccountId)}` : (t.accountName ?? nameOf(t.accountId)))
    + (t.personName ? ' · ' + t.personName : '');
  const data = queued ? `data-act="editq" data-id="${esc(t.clientId)}"` : `data-act="edit" data-id="${t.id}"`;
  const row = `<button class="item" ${data}>${txIcon(t)}<span class="t"><div>${esc(title)}${queued ? `<span class="tag">${queued === 'err' ? 'خطا' : 'در صف ارسال'}</span>` : ''}</div>
    <small>${fa(t.date)} · ${esc(sub)}</small></span><span class="amt ${sign}">${out ? '−' : ''}${money(t.amount)}${t.balance !== undefined ? `<small>مانده: ${money(t.balance)}</small>` : ''}</span></button>`;
  return queued || !t.id ? row : `<div class="sw"><div class="swa"><button type="button" data-act="edit" data-id="${t.id}">ویرایش</button><button type="button" class="d" data-act="swdel" data-id="${t.id}">حذف</button></div>${row}</div>`;
}
const queueRows = () => S.queue.map(q => txRow(q.tx, q.error ? 'err' : 'q')).join('');

function queueBanner() {
  const failed = S.queue.filter(q => q.error).length, waiting = S.queue.length - failed;
  let h = S.home.pending ? `<button class="banner bank" data-act="inbox">${fa(S.home.pending)} تراکنش بانکی منتظر تعیین تکلیف است.</button>` : '';
  for (const c of S.home.checks ?? []) if (c.diff && !c.waiting)
    h += `<button class="banner warn" data-act="stmt" data-id="${c.accountId}">مانده‌ی ${esc(c.name)} با پیامک بانک نمی‌خواند: اختلاف ${money(Math.abs(c.diff))} تومان. برای دیدن لمس کنید.</button>`;
  for (const b of S.home.budgets ?? [])
    h += `<button class="banner" data-act="report">${esc(b.name)}: ${fa(Math.round(b.spent * 100 / b.budget))}٪ سقف این ماه خرج شده (${money(b.spent)} از ${money(b.budget)}).</button>`;
  if (S.home.backupDue) h += `<button class="banner" data-act="backup">مدتی است پشتیبان نگرفته‌اید. برای گرفتن پشتیبان لمس کنید.</button>`;
  if (waiting) h += `<button class="banner" data-act="sync">${fa(waiting)} ثبت در صف ارسال است. برای ارسال لمس کنید.</button>`;
  if (failed) h += `<button class="banner" data-act="tab" data-v="list">${fa(failed)} ثبت رد شد و باید اصلاح شود.</button>`;
  return h;
}

function viewHome() {
  const h = S.home;
  $('#view').innerHTML = `
  <div class="card hero"><button class="maskbtn" data-act="mask" aria-label="پنهان کردن مبلغ‌ها">${masked() ? ICON.eyeoff : ICON.eye}</button><div class="lbl">کل موجودی</div>
    <div class="big" data-count="${h.cash + h.bank}">${money(h.cash + h.bank)} <span class="unit">تومان</span></div>
    <div class="row"><span>نقد: ${money(h.cash)}</span><span>بانک: ${money(h.bank)}</span></div></div>
  ${queueBanner()}
  <button class="ghost" data-act="paste">چسباندن پیامک بانک</button>
  <button class="ghost" data-act="smsfile">خواندن فایل پیامک‌ها</button>
  <div class="actions">
    <button class="a-out" data-act="new" data-k="expense">${ICON.expense}هزینه</button>
    <button data-act="new" data-k="income">${ICON.income}درآمد</button>
    <button data-act="new" data-k="transfer">${ICON.transfer}انتقال</button>
  </div>
  ${h.templates?.length ? `<h2>ثبت سریع</h2><div class="chips">${h.templates.map(t => `<button class="chip" data-act="tpl" data-id="${t.id}">${esc(t.name)}</button>`).join('')}</div>` : ''}
  ${h.due?.length ? `<h2>سررسیدها</h2>${h.due.map(r => `<div class="card due"><div class="row"><b>${esc(r.name)}</b><b class="${r.kind === 'income' ? 'pos' : 'neg'}">${money(r.amount)}</b></div>
    <small class="${r.overdue ? 'neg' : ''}">سررسید ${fa(r.next)}${r.overdue ? ' (گذشته)' : ''}${r.left ? ` · ${fa(r.left)} دفعه مانده` : ''}</small>
    <div class="two"><button class="ghost" data-act="duepay" data-id="${r.id}">ثبت</button><button class="ghost" data-act="dueskip" data-id="${r.id}">این بار نه</button></div></div>`).join('')}` : ''}
  <h2>این ماه</h2>
  <div class="stats">
    <div class="card"><small>درآمد</small><b class="pos">${money(h.income)}</b></div>
    <div class="card"><small>هزینه</small><b class="neg">${money(h.expense)}</b></div>
    <div class="card"><small>خالص</small><b class="${h.net < 0 ? 'neg' : 'pos'}">${money(h.net)}</b></div>
  </div>
  ${insightCard(h)}
  ${h.cats?.length ? `<h2>خرج این ماه به تفکیک دسته</h2><div class="card donutcard" data-act="report">${donut(h.cats, 'هزینه')}</div>` : ''}
  <h2>آخرین تراکنش‌ها</h2>
  ${h.recent.length || S.queue.length ? `<div class="list">${queueRows()}${byDay(h.recent, t => txRow(t))}</div>` : `<div class="card empty">هنوز تراکنشی ثبت نشده است.</div>`}`;
}

async function viewList() {
  const f = S.filter;
  $('#view').innerHTML = `<h1>تراکنش‌ها</h1>
  <input id="q" type="search" placeholder="جستجو در شرح و دسته" value="${esc(f.q)}" aria-label="جستجو">
  <select id="fa" aria-label="حساب"><option value="">همه‌ی حساب‌ها</option>${S.home.accounts.map(a => `<option value="${a.id}" ${String(a.id) === String(f.accountId ?? '') ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <div class="chips">${[['', 'همه'], ['expense', 'هزینه'], ['income', 'درآمد'], ['transfer', 'انتقال']].map(([k, t]) => `<button class="chip ${(f.kind || '') === k ? 'on' : ''}" data-act="fkind" data-k="${k}">${t}</button>`).join('')}</div>
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
  const list = S.home.accounts.map(a => `<button class="item" data-act="stmt" data-id="${a.id}"><span class="t"><div>${esc(a.name)}</div><small>${a.kind === 'bank' ? esc(a.bankName || 'بانک') : 'نقد'}</small></span><span class="amt ${a.balance < 0 ? 'neg' : ''}">${money(a.balance)}</span></button>`).join('');
  const ppl = (S.home.people ?? []).map(p => `<button class="item" data-act="person" data-id="${p.id}"><span class="t"><div>${esc(p.name)}</div><small>${p.balance > 0 ? 'طلب شما' : p.balance < 0 ? 'بدهی شما' : 'تسویه'}</small></span><span class="amt ${p.balance > 0 ? 'pos' : p.balance < 0 ? 'neg' : ''}">${money(Math.abs(p.balance))}</span></button>`).join('');
  $('#view').innerHTML = `<h1>حساب‌ها</h1><div class="list">${list || '<div class="empty">حسابی نیست.</div>'}</div>
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
    <div class="big">${money(r.account.balance)} <span class="unit">تومان</span></div>
    <div class="row"><span>موجودی اولیه: ${money(r.opening)}</span></div></div>
  ${checkCard(r.check)}
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
    <div class="big">${money(Math.abs(b))} <span class="unit">تومان</span></div></div>
  <div class="two">${PERSON_OPS.map(([t], i) => `<button class="ghost" data-act="pop" data-i="${i}">${t}</button>`).join('')}</div>
  <button class="ghost" data-act="pform" data-id="${r.person.id}">ویرایش شخص</button>
  <h2>گردش</h2>
  ${r.rows.length ? `<div class="list">${r.rows.map(t => txRow(t)).join('')}</div>` : '<div class="card empty">هنوز چیزی ثبت نشده است.</div>'}`;
}

function personForm(p) {
  const o = p?.openingBalance ?? 0;
  openSheet(`<form id="pf2" novalidate><div class="phead"><h1>${p ? 'ویرایش شخص' : 'شخص تازه'}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <label for="pn">نام</label><input id="pn" autocomplete="off" value="${esc(p?.name)}">
    <label for="po">مانده‌ی اول (اختیاری)</label><input id="po" class="amount" inputmode="numeric" autocomplete="off" value="${o ? fa(group(Math.abs(o))) : ''}">
    <select id="ps"><option value="1">او به من بدهکار است (طلب من)</option><option value="-1" ${o < 0 ? 'selected' : ''}>من به او بدهکارم</option></select>
    <div class="err" id="perr2" role="alert"></div><button class="primary">ذخیره</button>
    ${p ? `<button type="button" class="ghost danger" data-act="pdel" data-id="${p.id}">حذف از فهرست</button>` : ''}</form>`);
  $('#po').oninput = e => { const d = digits(e.target.value).replace(/^0+/, ''); e.target.value = d ? fa(group(d)) : ''; };
  $('#pf2').onsubmit = async e => {
    e.preventDefault();
    const body = { name: $('#pn').value.trim(), openingBalance: Number(digits($('#po').value) || 0) * Number($('#ps').value) };
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
  <h2>روند ۶ ماه</h2>${trendChart(r.trend)}
  <h2>هزینه به تفکیک دسته</h2>
  <p class="hint">برای تعیین یا برداشتن سقف ماهانه روی هر دسته بزنید.${r.refund ? ` برگشت وجه این ماه (${money(r.refund)}) از جمع هزینه کم شده است.` : ''}</p>
  ${exp ? `<div class="list">${exp}</div>` : '<div class="card empty">هزینه‌ای ثبت نشده است.</div>'}
  <h2>درآمد به تفکیک دسته</h2>
  ${inc ? `<div class="list">${inc}</div>` : '<div class="card empty">درآمدی ثبت نشده است.</div>'}`;
}

function recurringSheet() {
  const h = S.home, accs = h.accounts;
  const catOpts = kind => h.categories.filter(c => c.type === kind && (c.nature === 'pnl' || ['loan_out', 'debt_out', 'loan_in', 'receivable_in'].includes(c.code)))
    .map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const list = (h.recurring ?? []).map(r => `<div class="item"><span class="t"><div>${esc(r.name)}</div><small>هر ماه روز ${fa(r.day)} · بعدی ${fa(r.next)}${r.left ? ` · ${fa(r.left)} دفعه مانده` : ''}</small></span>
    <span class="amt ${r.kind === 'income' ? 'pos' : 'neg'}">${money(r.amount)}</span><button type="button" class="chip" data-act="delrec" data-id="${r.id}">حذف</button></div>`).join('');
  openSheet(`<form id="rf2" novalidate><div class="phead"><h1>پرداخت‌ها و دریافت‌های ماهانه</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <p class="hint">قسط، اجاره، قبض یا حقوق. چند روز مانده به سررسید در صفحه‌ی خانه دیده می‌شود و با «ثبت» وارد دفتر می‌شود. یادآوری بیرون از برنامه (اعلان) ممکن نیست.</p>
    ${list ? `<div class="list">${list}</div>` : ''}
    <h2>مورد تازه</h2>
    <label for="rn">نام</label><input id="rn" autocomplete="off" placeholder="مثلاً قسط وام">
    <label for="rk">نوع</label><select id="rk"><option value="expense">پرداخت</option><option value="income">دریافت</option></select>
    <label for="ra">مبلغ هر بار (تومان)</label><input id="ra" class="amount" inputmode="numeric" autocomplete="off">
    <label for="rc">دسته</label><select id="rc">${catOpts('expense')}</select>
    <label for="racc">حساب</label><select id="racc">${accs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
    ${h.people?.length ? `<label for="rp2">شخص (اختیاری)</label><select id="rp2">${personOpts(null)}</select>` : ''}
    <label for="rd">اولین سررسید</label>${dateInput('rd', fa(today()))}
    <label for="rl">تعداد دفعه‌ها (خالی = همیشگی)</label><input id="rl" inputmode="numeric" autocomplete="off">
    <div class="err" id="rerr2" role="alert"></div><button class="primary">افزودن</button></form>`);
  $('#rk').onchange = e => { $('#rc').innerHTML = catOpts(e.target.value); };
  $('#ra').oninput = e => { const d = digits(e.target.value).replace(/^0+/, ''); e.target.value = d ? fa(group(d)) : ''; };
  $('#rf2').onsubmit = async e => {
    e.preventDefault();
    const left = digits($('#rl').value);
    const body = { name: $('#rn').value.trim(), kind: $('#rk').value, amount: Number(digits($('#ra').value)), categoryId: Number($('#rc').value) || null,
      accountId: Number($('#racc').value), personId: Number($('#rp2')?.value) || null, next: normDate($('#rd').value), left: left ? Number(left) : null };
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
    const head = ['تاریخ', 'نوع', 'مبلغ (تومان)', 'حساب', 'به حساب', 'دسته', 'شخص', 'شرح', 'یادداشت', 'روش پرداخت'].map(q).join(',');
    const lines = rows.slice().reverse().map(t => [q(`="${t.date}"`), q(KIND[t.kind]), t.kind === 'expense' ? -t.amount : t.amount,
      q(t.accountName), q(t.toAccountName), q(t.categoryName), q(t.personName), q(t.description), q(t.notes), q(t.method)].join(','));
    const name = `hesab-${today().replaceAll('/', '-')}.csv`;
    if (await saveFile(new File(['\uFEFF' + [head, ...lines].join('\r\n')], name, { type: 'text/csv' }))) toast(`خروجی ${fa(rows.length)} ردیف ساخته شد.`);
  } catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'خروجی ساخته نشد.'); }
}

function checkCard(c) {
  if (!c) return '';
  const when = fa(c.date) + (c.time ? ' ساعت ' + fa(c.time) : '');
  if (c.waiting) return '<div class="card hint">پیامک‌های منتظرِ این حساب را اول در صندوق تراکنش‌ها تعیین تکلیف کنید تا مانده کنترل شود.</div>';
  if (!c.diff) return `<div class="card hint"><b class="pos">✓</b> با مانده‌ی آخرین پیامک بانک (${when}) یکی است.</div>`;
  return `<div class="card hint"><b class="neg">مانده با بانک نمی‌خواند</b><br>
    مانده در پیامک بانک (${when}): ${money(c.bank)} تومان<br>
    مانده‌ی برنامه در پایان همان روز: ${money(c.app)} تومان<br>
    اختلاف: ${money(c.diff)} تومان. ${c.diff > 0 ? 'برنامه کمتر از بانک است: شاید واریزی جا افتاده یا برداشتی دو بار ثبت شده.' : 'برنامه بیشتر از بانک است: شاید برداشت یا کارمزدی جا افتاده یا واریزی دو بار ثبت شده.'}
    اگر از اول اختلاف بوده، موجودی اولیه‌ی حساب را بررسی کنید.</div>`;
}

function viewMore() {
  const cats = t => S.home.categories.filter(c => c.type === t && !c.code).map(c => `<button class="chip" data-act="delcat" data-id="${c.id}" data-n="${esc(c.name)}">${esc(c.name)} ×</button>`).join('');
  $('#view').innerHTML = `<h1>بیشتر</h1>
  <h2>دسته‌های هزینه</h2><div class="chips">${cats('expense')}<button class="chip" data-act="addcat" data-t="expense">+ دسته‌ی تازه</button></div>
  <h2>دسته‌های درآمد</h2><div class="chips">${cats('income')}<button class="chip" data-act="addcat" data-t="income">+ دسته‌ی تازه</button></div>
  <h2>تراکنش‌های بانکی</h2><button class="ghost" data-act="inbox">صندوق پیامک‌های بانک</button>
  <h2>نصب روی آیفون</h2><div class="card hint">در Safari دکمه‌ی Share و بعد Add to Home Screen را بزنید.</div>
  <h2>گزارش و برنامه‌ریزی</h2>
  <button class="ghost" data-act="report">گزارش ماهانه و سقف خرج</button>
  <button class="ghost" data-act="recman">پرداخت‌ها و دریافت‌های ماهانه</button>
  ${S.home.templates?.length ? `<h2>ثبت‌های آماده</h2><div class="chips">${S.home.templates.map(t => `<button class="chip" data-act="deltpl" data-id="${t.id}" data-n="${esc(t.name)}">${esc(t.name)} ×</button>`).join('')}</div>` : ''}
  <h2>پشتیبان</h2><div class="card hint">اطلاعات فقط روی همین گوشی است. فایل پشتیبان را در iCloud Drive یا جای امن دیگری نگه دارید. آخرین پشتیبان: ${S.home.lastBackup ? fa(new Date(S.home.lastBackup).toLocaleDateString('fa-IR')) : 'هنوز گرفته نشده'}</div>
  <button class="ghost" data-act="backup">گرفتن پشتیبان</button><button class="ghost" data-act="restore">بازیابی از فایل</button>
  <h2>امنیت</h2><button class="ghost" data-act="chpass">تغییر رمز</button>
  <button class="ghost danger" data-act="logout">قفل برنامه</button>`;
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
  const catId = pre?.categoryId ?? null;
  const date = src?.date ?? today();
  const editing = !!src;
  openSheet(`<form id="txf" data-kind="${kind}" data-id="${src?.id ?? ''}" data-qid="${esc(qid ?? '')}" data-rid="${preset?.recurringId ?? ''}" novalidate>
    <div class="phead"><h1>${editing ? 'ویرایش ' : ''}${KIND[kind]}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <label for="amt">مبلغ (تومان)</label>
    <input id="amt" class="amount" inputmode="numeric" autocomplete="off" value="${pre?.amount ? fa(group(pre.amount)) : ''}">
    <div id="calc" class="calc" aria-live="polite"></div>
    <div class="chips ops"><button type="button" class="chip" data-act="zeros">۰۰۰+</button>${['+', '−', '×', '÷', '='].map(o => `<button type="button" class="chip op" data-act="op" data-o="${o}">${o}</button>`).join('')}</div>
    ${kind === 'transfer' ? `<label for="acc">از حساب</label><select id="acc">${opts(accId)}</select>
      <label for="to">به حساب</label><select id="to">${opts(toId)}</select>`
      : `<label>دسته</label><div class="chips" id="cats">${cats.map(c => `<button type="button" class="chip ${c.id === catId ? 'on' : ''}" data-act="cat" data-id="${c.id}">${catEmoji(c.name, kind)} ${esc(c.name)}</button>`).join('')}</div>
      <label for="acc">حساب</label><select id="acc">${opts(accId)}</select>`}
    <label for="date">تاریخ</label>${dateInput('date', fa(date))}
    <div class="chips"><button type="button" class="chip" data-act="setdate" data-d="t">امروز</button><button type="button" class="chip" data-act="setdate" data-d="y">دیروز</button></div>
    ${kind !== 'transfer' && S.home.people?.length ? `<label for="per">شخص (اختیاری)</label><select id="per">${personOpts(pre?.personId ?? null)}</select>` : ''}
    <label for="desc">شرح</label><input id="desc" autocomplete="off" value="${esc(pre?.description)}">
    <details ${src?.notes || src?.method ? 'open' : ''}><summary>جزئیات بیشتر</summary>
      <label for="method">روش پرداخت</label><select id="method"><option value=""></option>${METHODS.map(m => `<option ${m === pre?.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label for="notes">یادداشت</label><textarea id="notes" rows="2">${esc(src?.notes)}</textarea></details>
    <div class="err" id="err" role="alert">${esc(src?.queueError)}</div>
    <button class="primary">${editing ? 'ذخیره' : 'ثبت'}</button>
    ${editing ? `<button type="button" class="ghost danger" data-act="deltx">حذف</button>` : `<button type="button" class="ghost" data-act="savetpl">ذخیره به‌عنوان ثبت آماده</button>`}
  </form>`);
  $('#amt').oninput = e => { e.target.value = fmtExpr(e.target.value); showCalc(); };
  $('#txf').onsubmit = e => { e.preventDefault(); submitTx(); };
  if (!editing) $('#amt').focus();
}

/* خواندن فرم ثبت؛ اگر ایرادی باشد متن خطا برمی‌گردد. */
function readTx() {
  const kind = $('#txf').dataset.kind;
  const amount = calcExpr($('#amt').value), date = normDate($('#date').value);
  const accountId = Number($('#acc').value);
  const toAccountId = kind === 'transfer' ? Number($('#to').value) : null;
  const categoryId = kind === 'transfer' ? null : Number($('#cats .on')?.dataset.id) || null;
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
    try { await api('/api/transactions/' + f.dataset.id, 'PUT', tx); closeSheet(); done('ذخیره شد'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : err.textContent = e.net ? 'ویرایش فقط با اتصال به سرور انجام می‌شود.' : e.msg; }
    return;
  }
  const qid = f.dataset.qid;
  if (qid) S.queue = S.queue.filter(q => q.tx.clientId !== qid);
  S.queue.push({ tx: { ...tx, clientId: qid || uuid() } });
  if (!saveQueue()) { err.textContent = 'حافظه‌ی گوشی پر است؛ ثبت ذخیره نشد.'; S.queue.pop(); return; }
  closeSheet();
  await flush();
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
    <label for="ao">موجودی اولیه (تومان)</label><input id="ao" inputmode="numeric" class="date" value="${a ? fa(group(Math.abs(a.openingBalance))) : ''}">
    <div class="err" id="err" role="alert"></div><button class="primary">ذخیره</button>
    ${a ? `<button type="button" class="ghost danger" data-act="archive" data-id="${a.id}">بایگانی حساب</button>` : ''}</form>`);
  $('#ao').oninput = e => { const d = digits(e.target.value).replace(/^0+/, ''); e.target.value = d ? fa(group(d)) : ''; };
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const sign = a && a.openingBalance < 0 ? -1 : 1;
    const body = { name: $('#an').value, kind: $('#ak').value, bankName: $('#ab').value.trim() || null, accountNumber: en($('#au').value).trim() || null, openingBalance: sign * Number(digits($('#ao').value)) };
    try { await api('/api/accounts' + (a ? '/' + a.id : ''), a ? 'PUT' : 'POST', body); closeSheet(); toast('ذخیره شد.'); refresh(); }
    catch (x) { x.auth ? showAuth(true) : $('#err').textContent = x.msg; }
  };
}

const actions = {
  tab(b) { S.view = b.dataset.v; render(); window.scrollTo(0, 0); },
  new(b) { txForm(b.dataset.k); },
  close: closeSheet,
  sync() { for (const q of S.queue) delete q.error; refresh(); },
  zeros() { const i = $('#amt'); if (/\d$/.test(en(i.value))) i.value = fmtExpr(i.value + '000'); showCalc(); i.focus(); },
  op(b) {
    const i = $('#amt'), o = b.dataset.o;
    if (o === '=') { const r = calcExpr(i.value); if (r > 0) i.value = fa(group(r)); }
    else if (/\d$/.test(en(i.value))) i.value = fmtExpr(i.value + o);
    else if (i.value) i.value = i.value.replace(/[+−×÷]$/, o);
    showCalc(); i.focus();
  },
  cat(b) { $('#cats').querySelectorAll('.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); },
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
    const v = prompt(`سقف خرج ماهانه‌ی «${b.dataset.n}» به تومان (خالی = بدون سقف)`, b.dataset.b ? fa(group(b.dataset.b)) : '');
    if (v === null) return;
    const n = Number(digits(v));
    try { await api(`/api/categories/${b.dataset.id}/budget`, 'PUT', { budget: n || null }); toast(n ? 'سقف ذخیره شد.' : 'سقف برداشته شد.'); refresh(); }
    catch (e) { toast(e.msg); }
  },
  export: exportCsv,
  stmt(b) { S.accId = Number(b.dataset.id); S.view = 'stmt'; render(); window.scrollTo(0, 0); },
  acc(b) { accForm(S.home.accounts.find(a => a.id === Number(b.dataset.id))); },
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
  return kind === 'income' ? '💰' : '🧾';
}
const hue = s => { let h = 7; for (const ch of String(s ?? '')) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const catIcon = (name, kind) => `<i class="ci" style="--h:${hue(name)}" aria-hidden="true">${catEmoji(name, kind)}</i>`;
function txIcon(t) {
  if (t.kind === 'transfer') return '<i class="ci tr" style="--h:205" aria-hidden="true">⇄</i>';
  const c = S.home?.categories.find(x => x.id === t.categoryId);
  return catIcon(c?.name ?? t.categoryName, t.kind);
}

/* ---------- نمودار دایره‌ای و روند ---------- */
const PAL = ['#3fb7ff', '#ff7a8a', '#ffcf6b', '#3ddc97', '#b28cff', '#ff9f5a'];
function donut(items, label) {
  const total = items.reduce((s, x) => s + x.amount, 0); if (!total) return '';
  const r = 46, C = 2 * Math.PI * r; let off = 0;
  const top = items.slice(0, 5), rest = items.slice(5).reduce((s, x) => s + x.amount, 0);
  const parts = rest ? [...top, { name: null, amount: rest }] : top;
  const segs = parts.map((x, i) => {
    const len = C * x.amount / total;
    const s = `<circle class="s" r="${r}" cx="60" cy="60" stroke="${PAL[i]}" stroke-dasharray="${Math.max(0.5, len - (parts.length > 1 ? 2 : 0)).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" style="--i:${i}" transform="rotate(-90 60 60)"/>`;
    off += len; return s;
  }).join('');
  const legend = parts.map((x, i) => `<li><i style="background:${PAL[i]}"></i><span>${x.name ? catEmoji(x.name, 'expense') + ' ' + esc(x.name) : 'بقیه'}</span><b>${fa(Math.round(x.amount * 100 / total))}٪</b></li>`).join('');
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
  lines.push(`میانگین خرج روزانه: <b class="amtx">${money(Math.round(h.expense / day))}</b> تومان`);
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
    const sum = k => chunk.filter(t => t.kind === k).reduce((s, t) => s + t.amount, 0), inc = sum('income'), ex = sum('expense');
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
  return s.split(/([+−×÷])/).map(p => /^\d+$/.test(p) ? fa(group(p.replace(/^0+(?=\d)/, ''))) : p).join('');
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
  el.textContent = r > 0 ? `= ${money(r)} تومان` : /[+−×÷]/.test(v) && r <= 0 ? 'جمع باید بیشتر از صفر باشد' : '';
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
    ${g ? `<div class="goalhead">${ring(g.saved / g.target, 104)}<div><b>${money(g.saved)}</b> <span class="unit">از ${money(g.target)} تومان</span>
      <small>${g.saved >= g.target ? 'به هدف رسیدید 🎉' : `${money(g.target - g.saved)} تومان مانده`}</small></div></div>
      <label for="ga">مبلغ (تومان)</label><input id="ga" class="amount" inputmode="numeric" autocomplete="off">
      <div class="two"><button type="button" class="primary" data-act="gadd" data-s="1">افزودن به پس‌انداز</button><button type="button" class="ghost" data-act="gadd" data-s="-1">برداشت</button></div>
      <p class="hint">این بخش فقط پیشرفت هدف را می‌شمارد و پولی از حساب‌ها جابه‌جا نمی‌کند.</p>
      <details><summary>ویرایش یا حذف هدف</summary>` : ''}
    <label for="gn">نام هدف</label><input id="gn" autocomplete="off" placeholder="مثلاً خرید لپ‌تاپ" value="${esc(g?.name)}">
    <label for="gt">مبلغ هدف (تومان)</label><input id="gt" class="amount" inputmode="numeric" autocomplete="off" value="${g ? fa(group(g.target)) : ''}">
    <div class="err" id="gerr" role="alert"></div><button class="${g ? 'ghost' : 'primary'}">${g ? 'ذخیره‌ی تغییر' : 'ساخت هدف'}</button>
    ${g ? `<button type="button" class="ghost danger" data-act="gdel" data-id="${g.id}">حذف هدف</button></details>` : ''}</form>`);
  for (const i of document.querySelectorAll('#gf .amount')) i.oninput = e => { const d = digits(e.target.value).replace(/^0+/, ''); e.target.value = d ? fa(group(d)) : ''; };
  $('#gf').onsubmit = async e => {
    e.preventDefault();
    if (document.activeElement?.id === 'ga') return; // Enter در کادر مبلغ هدف را ویرایش نکند
    const body = { name: $('#gn').value.trim(), target: Number(digits($('#gt').value)) };
    try { await api(g ? '/api/goals/' + g.id : '/api/goals', g ? 'PUT' : 'POST', body); closeSheet(); done(g ? 'ذخیره شد' : 'هدف ساخته شد'); refresh(); }
    catch (x) { x.auth ? showAuth(true) : $('#gerr').textContent = x.msg; }
  };
  if (!g) $('#gn').focus();
}

Object.assign(actions, {
  mask() { const on = !masked(); document.documentElement.classList.toggle('mask', on); store.set('mask', on); render(); },
  async swdel(b) {
    if (!confirm('این تراکنش حذف شود؟')) return closeSw();
    try { await api('/api/transactions/' + b.dataset.id, 'DELETE'); toast('حذف شد.'); refresh(); }
    catch (e) { e.auth ? showAuth(true) : toast(e.msg || 'حذف نشد.'); }
  },
  goal(b) { goalSheet(b.dataset.id ? (S.home.goals ?? []).find(x => x.id === Number(b.dataset.id)) : null); },
  async gadd(b) {
    const id = Number($('#gf').dataset.id), a = Number(digits($('#ga').value)) * Number(b.dataset.s);
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

async function boot() {
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => { });
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
  if (document.hidden) hiddenAt = Date.now();
  else if (S.home && Date.now() - hiddenAt > 5 * 60e3) { Core.lock(); S.home = null; showAuth(true); } // قفل خودکار بعد از ۵ دقیقه
});
boot();
