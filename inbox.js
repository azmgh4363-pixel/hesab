'use strict';
/* صندوق تراکنش‌های بانکی: هر کارت فقط با تأیید کاربر وارد دفتر می‌شود. */
const PURPOSES = {
  deposit: [['income', 'درآمد'], ['receivable', 'دریافت طلب'], ['loan', 'دریافت قرض'], ['transfer', 'انتقال از حساب دیگر خودم'], ['refund', 'برگشت وجه'], ['other', 'سایر موارد']],
  withdrawal: [['expense', 'هزینه'], ['debt', 'پرداخت بدهی'], ['loan', 'پرداخت قرض'], ['transfer', 'انتقال به حساب دیگر خودم'], ['personal', 'برداشت شخصی'], ['other', 'سایر موارد']]
};

async function viewInbox() {
  $('#view').innerHTML = `<h1>تراکنش‌های بانکی</h1><div id="cards"><div class="empty">در حال خواندن…</div></div>
    <button class="ghost" data-act="paste">چسباندن پیامک بانک</button>
    <button class="ghost" data-act="smsfile">خواندن فایل پیامک‌ها</button>`;
  let rows;
  try { rows = await api('/api/bank-events'); }
  catch (e) {
    if (e.auth) return showAuth(true);
    $('#cards').innerHTML = '<div class="card empty">این بخش باز نشد.</div>';
    return;
  }
  S.events = rows; S.card = 0;
  showCard();
}

function showCard() {
  const box = $('#cards'); if (!box) return;
  const e = S.events[0];
  if (!e) { box.innerHTML = '<div class="card empty">تراکنش تعیین‌تکلیف‌نشده‌ای نیست.</div>'; return; }
  const dep = e.direction === 'deposit', sug = e.suggestion;
  const banks = S.home.accounts.filter(a => a.kind === 'bank');
  const accOpts = sel => `<option value=""></option>` + S.home.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const matches = e.matches.map(m => `<button class="ghost" data-act="evmatch" data-id="${m.id}">همان ${KIND[m.kind]} ثبت‌شده است: ${esc(m.description || m.categoryName || '')} (${fa(m.date)})${m.fee ? ` · کارمزد ${money(m.fee)} تومان جدا ثبت می‌شود` : ''}</button>`).join('');
  box.innerHTML = `<form class="card" id="evf" novalidate>
    <p class="hint">یک تراکنش بانکی جدید شناسایی شد. لطفاً ماهیت آن را مشخص کنید.${S.events.length > 1 ? ` (${fa(S.events.length)} مورد مانده)` : ''}</p>
    <div class="evamt ${dep ? 'pos' : 'neg'}">${dep ? '+' : '−'}${money(e.amount)} <span class="unit">تومان</span></div>
    <div class="hint">${dep ? 'واریز' : 'برداشت'} · ${fa(e.date)}${e.time ? ' · ' + fa(e.time) : ''}</div>
    <details><summary>متن پیامک</summary><div class="raw">${esc(e.rawText)}</div></details>
    <label for="eacc">حساب بانکی</label><select id="eacc">${accOpts(e.accountId)}</select>
    ${matches ? `<h2>شاید قبلاً ثبت شده باشد</h2>${matches}` : ''}
    <h2>${dep ? 'این واریزی بابت چیست؟' : 'این برداشت بابت چیست؟'}</h2>
    ${sug ? `<p class="hint">پیشنهاد از روی انتخاب‌های قبلی شماست؛ تا تأیید نکنید ثبت نمی‌شود.</p>` : ''}
    <div class="chips" id="pur">${PURPOSES[e.direction].map(([k, t]) => `<button type="button" class="chip ${sug?.purpose === k ? 'on' : ''}" data-act="evpur" data-k="${k}">${t}</button>`).join('')}</div>
    <div id="evx"></div>
    <label for="edesc">شرح</label><input id="edesc" autocomplete="off">
    <div class="err" id="err" role="alert"></div>
    <button class="primary">تأیید و ثبت</button>
    <button type="button" class="ghost" data-act="evignore">نادیده بگیر</button>
  </form>`;
  $('#evf').onsubmit = ev => { ev.preventDefault(); resolveCard(); };
  if (!banks.length) $('#err').textContent = 'هنوز حساب بانکی تعریف نشده است.';
  evExtra(sug?.purpose, sug);
}

function evExtra(purpose, sug) {
  const e = S.events[0], el = $('#evx');
  if (purpose === 'income' || purpose === 'expense') {
    const cats = S.home.categories.filter(c => c.type === purpose && c.nature === 'pnl');
    el.innerHTML = `<label>دسته</label><div class="chips" id="cats">${cats.map(c => `<button type="button" class="chip ${c.id === sug?.categoryId ? 'on' : ''}" data-act="cat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>`;
  } else if (purpose === 'transfer') {
    const others = S.home.accounts.filter(a => a.id !== Number($('#eacc').value));
    el.innerHTML = `<label for="eoth">${e.direction === 'deposit' ? 'از حساب' : 'به حساب'}</label><select id="eoth">${others.map(a => `<option value="${a.id}" ${a.id === sug?.otherAccountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  } else if (['receivable', 'loan', 'debt'].includes(purpose) && S.home.people?.length) {
    el.innerHTML = `<label for="eper">شخص</label><select id="eper">${personOpts(sug?.personId ?? null)}</select>`;
  } else el.innerHTML = '';
}

async function sendResolve(body) {
  const e = S.events[0];
  try {
    await api(`/api/bank-events/${e.id}/resolve`, 'POST', body);
    S.events.shift(); toast('ثبت شد.'); showCard(); updateHome();
  } catch (x) { x.auth ? showAuth(true) : $('#err').textContent = x.msg; }
}
async function updateHome() {
  try { S.home = await api('/api/home'); S.stale = false; } catch { }
}

function resolveCard() {
  const purpose = $('#pur .on')?.dataset.k, err = $('#err');
  const accountId = Number($('#eacc').value) || null;
  if (!accountId) return err.textContent = 'حساب بانکی را انتخاب کنید.';
  if (!purpose) return err.textContent = 'ماهیت تراکنش را انتخاب کنید.';
  const categoryId = Number($('#cats .on')?.dataset.id) || null;
  if ((purpose === 'income' || purpose === 'expense') && !categoryId) return err.textContent = 'دسته را انتخاب کنید.';
  const otherAccountId = purpose === 'transfer' ? Number($('#eoth')?.value) || null : null;
  if (purpose === 'transfer' && !otherAccountId) return err.textContent = 'حساب دیگر را انتخاب کنید.';
  sendResolve({ purpose, accountId, categoryId, otherAccountId, personId: Number($('#eper')?.value) || null, description: $('#edesc').value.trim() || null, transactionId: null });
}

Object.assign(actions, {
  smsfile() {
    openSheet(`<form id="sf" novalidate><div class="phead"><h1>خواندن فایل پیامک‌ها</h1><button type="button" class="x" data-act="close">بستن</button></div>
      <p class="hint">پیامک‌های فایل به صندوق تراکنش‌ها می‌آیند و تا تأیید نکنید ثبت نمی‌شوند. پیامک تکراری دوباره نمی‌آید.</p>
      <label for="sfile">فایل sms.txt</label><input id="sfile" type="file">
      <div class="err" id="serr" role="alert"></div><button class="primary">خواندن فایل</button>
      <button type="button" class="ghost" data-act="smsblank">ساخت یا خالی کردن فایل</button></form>`);
    $('#sf').onsubmit = async ev => {
      ev.preventDefault();
      const f = $('#sfile').files[0];
      if (!f) return $('#serr').textContent = 'فایل را انتخاب کنید.';
      try {
        const r = await api('/api/bank-events/import', 'POST', { text: await f.text() });
        closeSheet(); toast(`${fa(r.added)} پیامک تازه، ${fa(r.duplicate)} تکراری، ${fa(r.skipped)} خوانده‌نشده`);
        await updateHome(); S.view = 'inbox'; render();
      } catch (x) { x.auth ? showAuth(true) : $('#serr').textContent = x.msg || 'فایل خوانده نشد.'; }
    };
  },
  async smsblank() {
    try { if (await saveFile(new File(['###\n'], 'sms.txt', { type: 'text/plain' }))) toast('فایل خالی ساخته شد.'); }
    catch { toast('فایل ساخته نشد.'); }
  },
  inbox() { S.view = 'inbox'; render(); window.scrollTo(0, 0); },
  evpur(b) { $('#pur').querySelectorAll('.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); evExtra(b.dataset.k); },
  evmatch(b) {
    const accountId = Number($('#eacc').value) || null;
    if (!accountId) return $('#err').textContent = 'حساب بانکی را انتخاب کنید.';
    sendResolve({ purpose: 'match', accountId, transactionId: Number(b.dataset.id) });
  },
  async evignore() {
    if (!confirm('این تراکنش نادیده گرفته شود؟ وارد دفتر نمی‌شود.')) return;
    try { await api(`/api/bank-events/${S.events[0].id}/ignore`, 'POST'); S.events.shift(); showCard(); updateHome(); }
    catch (x) { $('#err').textContent = x.msg; }
  },
  paste() {
    openSheet(`<form id="pf" novalidate><div class="phead"><h1>چسباندن پیامک</h1><button type="button" class="x" data-act="close">بستن</button></div>
      <label for="ptxt">متن پیامک بانک</label><textarea id="ptxt" rows="6"></textarea>
      <div class="err" id="perr" role="alert"></div><button class="primary">خواندن پیامک</button></form>`);
    $('#ptxt').focus();
    $('#pf').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const r = await api('/api/bank-events/paste', 'POST', { text: $('#ptxt').value });
        closeSheet(); toast(r.duplicate ? 'این پیامک قبلاً خوانده شده است.' : 'پیامک خوانده شد.');
        await updateHome(); S.view = 'inbox'; render();
      } catch (x) { x.auth ? showAuth(true) : $('#perr').textContent = x.msg; }
    };
  }
});
