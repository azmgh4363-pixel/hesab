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
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  ({ home: viewHome, list: viewList, accounts: viewAccounts, more: viewMore, inbox: viewInbox })[S.view]();
}

function txRow(t, queued) {
  const sign = t.kind === 'income' ? 'pos' : t.kind === 'expense' ? 'neg' : '';
  const acc = S.home.accounts, nameOf = id => acc.find(a => a.id === id)?.name ?? '';
  const cat = S.home.categories.find(c => c.id === t.categoryId)?.name;
  const title = t.description || t.categoryName || cat || KIND[t.kind];
  const sub = t.kind === 'transfer' ? `${t.accountName ?? nameOf(t.accountId)} ← ${t.toAccountName ?? nameOf(t.toAccountId)}` : (t.accountName ?? nameOf(t.accountId));
  const data = queued ? `data-act="editq" data-id="${esc(t.clientId)}"` : `data-act="edit" data-id="${t.id}"`;
  return `<button class="item" ${data}><span class="t"><div>${esc(title)}${queued ? `<span class="tag">${queued === 'err' ? 'خطا' : 'در صف ارسال'}</span>` : ''}</div>
    <small>${fa(t.date)} · ${esc(sub)}</small></span><span class="amt ${sign}">${t.kind === 'expense' ? '−' : ''}${money(t.amount)}</span></button>`;
}
const queueRows = () => S.queue.map(q => txRow(q.tx, q.error ? 'err' : 'q')).join('');

function queueBanner() {
  const failed = S.queue.filter(q => q.error).length, waiting = S.queue.length - failed;
  let h = S.home.pending ? `<button class="banner bank" data-act="inbox">${fa(S.home.pending)} تراکنش بانکی منتظر تعیین تکلیف است.</button>` : '';
  if (S.home.backupDue) h += `<button class="banner" data-act="backup">مدتی است پشتیبان نگرفته‌اید. برای گرفتن پشتیبان لمس کنید.</button>`;
  if (waiting) h += `<button class="banner" data-act="sync">${fa(waiting)} ثبت در صف ارسال است. برای ارسال لمس کنید.</button>`;
  if (failed) h += `<button class="banner" data-act="tab" data-v="list">${fa(failed)} ثبت رد شد و باید اصلاح شود.</button>`;
  return h;
}

function viewHome() {
  const h = S.home;
  $('#view').innerHTML = `
  <div class="card hero"><div class="lbl">کل موجودی</div>
    <div class="big">${money(h.cash + h.bank)} <span class="unit">تومان</span></div>
    <div class="row"><span>نقد: ${money(h.cash)}</span><span>بانک: ${money(h.bank)}</span></div></div>
  ${queueBanner()}
  <button class="ghost" data-act="paste">چسباندن پیامک بانک</button>
  <div class="actions">
    <button class="a-out" data-act="new" data-k="expense">هزینه</button>
    <button data-act="new" data-k="income">درآمد</button>
    <button data-act="new" data-k="transfer">انتقال</button>
  </div>
  <h2>این ماه</h2>
  <div class="stats">
    <div class="card"><small>درآمد</small><b class="pos">${money(h.income)}</b></div>
    <div class="card"><small>هزینه</small><b class="neg">${money(h.expense)}</b></div>
    <div class="card"><small>خالص</small><b class="${h.net < 0 ? 'neg' : 'pos'}">${money(h.net)}</b></div>
  </div>
  <h2>آخرین تراکنش‌ها</h2>
  ${h.recent.length || S.queue.length ? `<div class="list">${queueRows()}${h.recent.map(t => txRow(t)).join('')}</div>` : `<div class="card empty">هنوز تراکنشی ثبت نشده است.</div>`}`;
}

async function viewList() {
  const f = S.filter;
  $('#view').innerHTML = `<h1>تراکنش‌ها</h1>
  <input id="q" type="search" placeholder="جستجو در شرح و دسته" value="${esc(f.q)}" aria-label="جستجو">
  <div class="chips">${[['', 'همه'], ['expense', 'هزینه'], ['income', 'درآمد'], ['transfer', 'انتقال']].map(([k, t]) => `<button class="chip ${(f.kind || '') === k ? 'on' : ''}" data-act="fkind" data-k="${k}">${t}</button>`).join('')}</div>
  <div class="two"><div><label for="ff">از تاریخ</label><input id="ff" class="date" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۱" value="${esc(f.from)}"></div>
  <div><label for="ft">تا تاریخ</label><input id="ft" class="date" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۳۰" value="${esc(f.to)}"></div></div>
  <div id="rows" class="list mt"></div>`;
  $('#q').oninput = debounce(e => { f.q = e.target.value; loadRows(); });
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
  for (const k of ['q', 'kind', 'from', 'to']) if (f[k]) p.set(k, f[k]);
  let rows, note = '';
  try { rows = await api('/api/transactions?' + p); S.rows = rows; }
  catch (e) {
    if (e.auth) return showAuth(true);
    rows = S.home.recent; note = '<div class="empty">بدون اتصال فقط آخرین تراکنش‌ها دیده می‌شوند.</div>';
  }
  const el = $('#rows'); if (!el) return;
  el.innerHTML = queueRows() + rows.map(t => txRow(t)).join('') + note || '<div class="empty">موردی پیدا نشد.</div>';
}

function viewAccounts() {
  const list = S.home.accounts.map(a => `<button class="item" data-act="acc" data-id="${a.id}"><span class="t"><div>${esc(a.name)}</div><small>${a.kind === 'bank' ? esc(a.bankName || 'بانک') : 'نقد'}</small></span><span class="amt ${a.balance < 0 ? 'neg' : ''}">${money(a.balance)}</span></button>`).join('');
  $('#view').innerHTML = `<h1>حساب‌ها</h1><div class="list">${list || '<div class="empty">حسابی نیست.</div>'}</div>
  <button class="primary" data-act="acc">افزودن حساب</button>`;
}

function viewMore() {
  const cats = t => S.home.categories.filter(c => c.type === t && !c.code).map(c => `<button class="chip" data-act="delcat" data-id="${c.id}" data-n="${esc(c.name)}">${esc(c.name)} ×</button>`).join('');
  $('#view').innerHTML = `<h1>بیشتر</h1>
  <h2>دسته‌های هزینه</h2><div class="chips">${cats('expense')}<button class="chip" data-act="addcat" data-t="expense">+ دسته‌ی تازه</button></div>
  <h2>دسته‌های درآمد</h2><div class="chips">${cats('income')}<button class="chip" data-act="addcat" data-t="income">+ دسته‌ی تازه</button></div>
  <h2>تراکنش‌های بانکی</h2><button class="ghost" data-act="inbox">صندوق پیامک‌های بانک</button>
  <h2>نصب روی آیفون</h2><div class="card hint">در Safari دکمه‌ی Share و بعد Add to Home Screen را بزنید.</div>
  <h2>پشتیبان</h2><div class="card hint">اطلاعات فقط روی همین گوشی است. فایل پشتیبان را در iCloud Drive یا جای امن دیگری نگه دارید. آخرین پشتیبان: ${S.home.lastBackup ? fa(new Date(S.home.lastBackup).toLocaleDateString('fa-IR')) : 'هنوز گرفته نشده'}</div>
  <button class="ghost" data-act="backup">گرفتن پشتیبان</button><button class="ghost" data-act="restore">بازیابی از فایل</button>
  <button class="ghost danger" data-act="logout">قفل برنامه</button>`;
}

function openSheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false; }
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }

/* فرم ثبت و ویرایش تراکنش. src: تراکنش موجود، یا qid برای ثبت داخل صف */
function txForm(kind, src, qid) {
  const accs = S.home.accounts;
  if (!accs.length) return toast('اول یک حساب بسازید.');
  const last = store.get('lastAcc', null);
  const accId = src?.accountId ?? (accs.some(a => a.id === last) ? last : accs[0].id);
  const opts = sel => accs.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const toId = src?.toAccountId ?? accs.find(a => a.id !== accId)?.id;
  const cats = S.home.categories.filter(c => c.type === kind && (c.nature === 'pnl' || c.id === src?.categoryId));
  const catId = src?.categoryId ?? null;
  const date = src?.date ?? today();
  const editing = !!src;
  openSheet(`<form id="txf" data-kind="${kind}" data-id="${src?.id ?? ''}" data-qid="${esc(qid ?? '')}" novalidate>
    <div class="phead"><h1>${editing ? 'ویرایش ' : ''}${KIND[kind]}</h1><button type="button" class="x" data-act="close">بستن</button></div>
    <label for="amt">مبلغ (تومان)</label>
    <input id="amt" class="amount" inputmode="numeric" autocomplete="off" value="${src ? fa(group(src.amount)) : ''}">
    <div class="chips"><button type="button" class="chip" data-act="zeros">۰۰۰+</button></div>
    ${kind === 'transfer' ? `<label for="acc">از حساب</label><select id="acc">${opts(accId)}</select>
      <label for="to">به حساب</label><select id="to">${opts(toId)}</select>`
      : `<label>دسته</label><div class="chips" id="cats">${cats.map(c => `<button type="button" class="chip ${c.id === catId ? 'on' : ''}" data-act="cat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <label for="acc">حساب</label><select id="acc">${opts(accId)}</select>`}
    <label for="date">تاریخ</label><input id="date" class="date" inputmode="numeric" value="${fa(date)}">
    <div class="chips"><button type="button" class="chip" data-act="setdate" data-d="t">امروز</button><button type="button" class="chip" data-act="setdate" data-d="y">دیروز</button></div>
    <label for="desc">شرح</label><input id="desc" autocomplete="off" value="${esc(src?.description)}">
    <details ${src?.notes || src?.method ? 'open' : ''}><summary>جزئیات بیشتر</summary>
      <label for="method">روش پرداخت</label><select id="method"><option value=""></option>${METHODS.map(m => `<option ${m === src?.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label for="notes">یادداشت</label><textarea id="notes" rows="2">${esc(src?.notes)}</textarea></details>
    <div class="err" id="err" role="alert">${esc(src?.queueError)}</div>
    <button class="primary">${editing ? 'ذخیره' : 'ثبت'}</button>
    ${editing ? `<button type="button" class="ghost danger" data-act="deltx">حذف</button>` : ''}
  </form>`);
  $('#amt').oninput = e => { const d = digits(e.target.value).replace(/^0+/, ''); e.target.value = d ? fa(group(d)) : ''; };
  $('#txf').onsubmit = e => { e.preventDefault(); submitTx(); };
  if (!editing) $('#amt').focus();
}

async function submitTx() {
  const f = $('#txf'), kind = f.dataset.kind, err = $('#err');
  const amount = Number(digits($('#amt').value)), date = normDate($('#date').value);
  const accountId = Number($('#acc').value);
  const toAccountId = kind === 'transfer' ? Number($('#to').value) : null;
  const categoryId = kind === 'transfer' ? null : Number($('#cats .on')?.dataset.id) || null;
  if (!amount) return err.textContent = 'مبلغ را وارد کنید.';
  if (kind !== 'transfer' && !categoryId) return err.textContent = 'دسته را انتخاب کنید.';
  if (kind === 'transfer' && accountId === toAccountId) return err.textContent = 'حساب مبدأ و مقصد نباید یکی باشند.';
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date)) return err.textContent = 'تاریخ را مثل ۱۴۰۵/۰۸/۱۵ وارد کنید.';
  const tx = { kind, date, amount, accountId, toAccountId, categoryId, description: $('#desc').value.trim() || null, notes: $('#notes').value.trim() || null, method: $('#method').value || null };
  store.set('lastAcc', accountId);
  if (f.dataset.id) {
    try { await api('/api/transactions/' + f.dataset.id, 'PUT', tx); closeSheet(); toast('ذخیره شد.'); refresh(); }
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
  toast(left ? 'در صف ارسال ماند؛ با وصل شدن ارسال می‌شود.' : 'ثبت شد.');
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
  zeros() { const i = $('#amt'), d = digits(i.value); if (d) { i.value = fa(group(d + '000')); } i.focus(); },
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
  acc(b) { accForm(S.home.accounts.find(a => a.id === Number(b.dataset.id))); },
  async archive(b) {
    if (!confirm('این حساب بایگانی شود؟')) return;
    try { await api('/api/accounts/' + b.dataset.id, 'DELETE'); closeSheet(); refresh(); } catch (e) { $('#err').textContent = e.msg; }
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
      const file = new File([text], name, { type: 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (e) { if (e.name === 'AbortError') return toast('پشتیبان ذخیره نشد.'); throw e; } }
      else { const u = URL.createObjectURL(file), l = document.createElement('a'); l.href = u; l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
      toast('فایل پشتیبان ساخته شد.'); refresh();
    } catch (e) { toast(e.msg || 'ساخت پشتیبان انجام نشد.'); }
  },
  restore() { restoreForm(false); }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) { e.preventDefault(); actions[b.dataset.act]?.(b); }
  else if (e.target.id === 'sheet') closeSheet();
});

function showAuth(hasUser) {
  closeSheet();
  S.view = 'home';
  $('#tabs').hidden = true;
  $('#view').innerHTML = `<form class="auth" id="lf" novalidate><h1>${hasUser ? 'باز کردن قفل' : 'شروع'}</h1>
    ${hasUser ? '' : '<p class="hint">این رمز اطلاعات را رمزگذاری می‌کند و حداقل ۶ حرف است. اگر فراموش شود، اطلاعات و پشتیبان‌ها باز نمی‌شوند و راه بازیابی ندارد.</p>'}
    <label for="p">رمز</label><input id="p" type="password" autocomplete="${hasUser ? 'current-password' : 'new-password'}">
    ${hasUser ? '' : '<label for="p2">تکرار رمز</label><input id="p2" type="password" autocomplete="new-password">'}
    <div class="err" id="err" role="alert"></div><button class="primary">${hasUser ? 'باز کردن' : 'شروع'}</button>
    ${hasUser ? '' : '<button type="button" class="ghost" data-act="restore">بازیابی از فایل پشتیبان</button>'}</form>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    if (!hasUser && $('#p').value !== $('#p2').value) return $('#err').textContent = 'دو رمز یکی نیستند.';
    try { await api('/api/auth/' + (hasUser ? 'login' : 'setup'), 'POST', { password: $('#p').value }); await refresh(); }
    catch (x) { $('#err').textContent = x.msg; }
  };
  if (hasUser) $('#p').focus();
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
