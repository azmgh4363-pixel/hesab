'use strict';
/* صندوق تراکنش‌های بانکی: هر کارت فقط با تأیید کاربر وارد دفتر می‌شود. */
/* گروه اول انتخاب می‌شود و بعد گزینه‌های همان گروه؛ هر گزینه یک purpose (و شاید دسته) دارد. */
const GROUPS = {
  deposit: [['pnl', 'درآمد'], ['neutral', 'خنثی'], ['transfer', 'انتقال بین حساب‌ها'], ['people', 'طلب و بدهی']],
  withdrawal: [['pnl', 'هزینه'], ['neutral', 'خنثی'], ['transfer', 'انتقال بین حساب‌ها'], ['people', 'طلب و بدهی']]
};
const EXTRA = {
  deposit: { pnl: [['refund', 'برگشت وجه']], neutral: [['other', 'سایر واریزها']], people: [['receivable', 'دریافت طلب'], ['loan', 'دریافت قرض']] },
  withdrawal: { pnl: [], neutral: [['personal', 'برداشت شخصی'], ['other', 'سایر برداشت‌ها']], people: [['debt', 'پرداخت بدهی'], ['loan', 'پرداخت قرض']] }
};
const groupOf = (e, purpose) => !purpose ? null : purpose === 'income' || purpose === 'expense' ? 'pnl' : purpose === 'neutral' || purpose === 'transfer' ? purpose
  : Object.keys(EXTRA[e.direction]).find(g => EXTRA[e.direction][g].some(([k]) => k === purpose)) ?? null;
const curEv = () => S.events.find(e => e.id === S.card);

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
  S.events = rows;
  if (!curEv()) S.card = rows.length === 1 ? rows[0].id : null;
  showCard();
}

function showCard() {
  const box = $('#cards'); if (!box) return;
  const e = curEv();
  if (!S.events.length) { box.innerHTML = '<div class="card empty">تراکنش تعیین‌تکلیف‌نشده‌ای نیست.</div>'; return; }
  if (!e) {
    const acc = id => S.home.accounts.find(a => a.id === id)?.name ?? 'حساب نامشخص';
    box.innerHTML = `<p class="hint">${fa(S.events.length)} تراکنش منتظر شماست؛ روی هرکدام بزنید تا مشخصش کنید.</p><div class="list">${S.events.slice().reverse().map(x => {
      const dep = x.direction === 'deposit';
      return `<button type="button" class="item" data-act="evopen" data-id="${x.id}"><i class="ci" style="--h:${dep ? 150 : 350}" aria-hidden="true">${dep ? '⬇️' : '⬆️'}</i><span class="t"><div>${dep ? 'واریز' : 'برداشت'} · ${esc(acc(x.accountId))}</div><small>${fa(x.date)}${x.time ? ' · ' + fa(x.time) : ''}</small></span><span class="amt ${dep ? 'pos' : 'neg'}">${dep ? '+' : '−'}${money(x.amount)}</span></button>`;
    }).join('')}</div>`;
    return;
  }
  const dep = e.direction === 'deposit', sug = e.suggestion;
  const banks = S.home.accounts.filter(a => a.kind === 'bank');
  const accOpts = sel => `<option value=""></option>` + S.home.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const matches = e.matches.map(m => `<button class="ghost" data-act="evmatch" data-id="${m.id}">همان ${KIND[m.kind]} ثبت‌شده است: ${esc(m.description || m.categoryName || '')} (${fa(m.date)})${m.fee ? ` · کارمزد ${money(m.fee)} ${unitName()} جدا ثبت می‌شود` : ''}</button>`).join('');
  /* ثبت آماده‌های هم‌جهت (برداشت = هزینه، واریز = درآمد) با دسته‌ی عادی */
  const kind = dep ? 'income' : 'expense';
  const tpls = (S.home.templates ?? []).filter(t => t.kind === kind && ['pnl', 'neutral'].includes(S.home.categories.find(c => c.id === t.categoryId)?.nature))
    .map(t => `<button type="button" class="chip tq" data-act="evtpl" data-id="${t.id}">${catEmoji(S.home.categories.find(c => c.id === t.categoryId)?.name, kind)} ${esc(t.name)}</button>`).join('');
  const grp = groupOf(e, sug?.purpose);
  box.innerHTML = `${S.events.length > 1 ? `<button type="button" class="ghost" data-act="evlist">→ همه‌ی تراکنش‌های منتظر (${fa(S.events.length)})</button>` : ''}<form class="card" id="evf" novalidate>
    <p class="hint">این تراکنش را مشخص کنید.</p>
    <div class="evamt ${dep ? 'pos' : 'neg'}">${dep ? '+' : '−'}${money(e.amount)} <span class="unit">${unitName()}</span></div>
    <div class="hint">${dep ? 'واریز' : 'برداشت'} · ${fa(e.date)}${e.time ? ' · ' + fa(e.time) : ''}</div>
    <button type="button" class="ghost" data-act="evfixopen">✎ مبلغ، نوع یا تاریخ درست نیست؟</button><div id="evfix" hidden></div>
    <details><summary>متن پیامک</summary><div class="raw">${esc(e.rawText)}</div></details>
    <label for="eacc">حساب بانکی</label><select id="eacc">${accOpts(e.accountId)}</select>
    ${matches ? `<h2>شاید قبلاً ثبت شده باشد</h2>${matches}` : ''}
    <h2>${dep ? 'این واریزی بابت چیست؟' : 'این برداشت بابت چیست؟'}</h2>
    ${tpls ? `<p class="hint">با یک لمس، با مبلغ و تاریخ همین پیامک ثبت می‌شود:</p><div class="chips evtpl">${tpls}</div><p class="hint">یا خودتان انتخاب کنید:</p>` : ''}
    ${sug ? `<p class="hint">پیشنهاد از روی انتخاب‌های قبلی شماست؛ تا تأیید نکنید ثبت نمی‌شود.</p>` : ''}
    <div class="chips" id="pur">${GROUPS[e.direction].map(([k, t]) => `<button type="button" class="chip ${grp === k ? 'on' : ''}" data-act="evpur" data-k="${k}">${t}</button>`).join('')}</div>
    <div id="evx"></div>
    <label for="edesc">شرح</label><input id="edesc" autocomplete="off">
    <div class="err" id="err" role="alert"></div>
    <button class="primary">تأیید و ثبت</button>
    <button type="button" class="ghost" data-act="evignore">نادیده بگیر</button>
  </form>`;
  $('#evf').onsubmit = ev => { ev.preventDefault(); resolveCard(); };
  if (!banks.length) $('#err').textContent = 'هنوز حساب بانکی تعریف نشده است.';
  evExtra(grp, sug);
}

function evExtra(group, sug) {
  const e = curEv(), el = $('#evx'), kind = e.direction === 'deposit' ? 'income' : 'expense';
  const chip = (k, id, name, ico) => `<button type="button" class="chip ${sug?.purpose === k && (!id || id === sug?.categoryId) ? 'on' : ''}" data-act="cat" data-k="${k}"${id ? ` data-id="${id}"` : ''}>${ico ? ico + ' ' : ''}${esc(name)}</button>`;
  const extra = (EXTRA[e.direction][group] ?? []).map(([k, t]) => chip(k, null, t)).join('');
  if (group === 'pnl') {
    const cats = S.home.categories.filter(c => c.type === kind && c.nature === 'pnl');
    el.innerHTML = `<label>دسته</label><div class="chips" id="cats">${cats.map(c => chip(kind, c.id, c.name, catEmoji(c.name, kind))).join('')}${extra}</div>`;
  } else if (group === 'neutral') {
    const cats = S.home.categories.filter(c => c.nature === 'neutral');
    el.innerHTML = `<label>دسته‌ی خنثی (در درآمد و هزینه حساب نمی‌شود)</label><div class="chips" id="cats">${cats.map(c => chip('neutral', c.id, c.name, catEmoji(c.name, 'neutral'))).join('')}${extra}<button type="button" class="chip" data-act="evaddcat">+ دسته‌ی تازه</button></div>`;
  } else if (group === 'transfer') {
    const others = S.home.accounts.filter(a => a.id !== Number($('#eacc').value));
    el.innerHTML = `<label for="eoth">${e.direction === 'deposit' ? 'از حساب' : 'به حساب'}</label><select id="eoth">${others.map(a => `<option value="${a.id}" ${a.id === sug?.otherAccountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  } else if (group === 'people') {
    el.innerHTML = `<div class="chips" id="cats">${extra}</div>` + (!S.home.people?.length ? '' : `<label for="eper">شخص</label><select id="eper">${personOpts(sug?.personId ?? null)}</select>`);
  } else el.innerHTML = '';
}

async function sendResolve(body) {
  const e = curEv();
  try {
    await api(`/api/bank-events/${e.id}/resolve`, 'POST', body);
    toast('ثبت شد.'); await nextEvents();
  } catch (x) { x.auth ? showAuth(true) : $('#err').textContent = x.msg; }
}
/* فهرست از نو خوانده می‌شود تا پیامکی که در همین فاصله رسیده هم دیده شود. */
async function nextEvents() { S.card = null; await updateHome(); if (S.view === 'inbox') { await viewInbox(); window.scrollTo(0, 0); } }
async function updateHome() {
  try { S.home = await api('/api/home'); S.stale = false; } catch { }
}

function resolveCard() {
  const group = $('#pur .on')?.dataset.k, opt = $('#cats .on'), err = $('#err');
  const purpose = group === 'transfer' ? 'transfer' : opt?.dataset.k;
  const accountId = Number($('#eacc').value) || null;
  if (!accountId) return err.textContent = 'حساب بانکی را انتخاب کنید.';
  if (!group) return err.textContent = 'ماهیت تراکنش را انتخاب کنید.';
  if (!purpose) return err.textContent = group === 'people' ? 'یکی از گزینه‌های طلب و بدهی را انتخاب کنید.' : 'دسته را انتخاب کنید.';
  const categoryId = Number(opt?.dataset.id) || null;
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
  inbox() { S.view = 'inbox'; S.card = null; render(); window.scrollTo(0, 0); },
  evopen(b) { S.card = Number(b.dataset.id); showCard(); window.scrollTo(0, 0); },
  evlist() { S.card = null; showCard(); window.scrollTo(0, 0); },
  /* اصلاح پیامکِ اشتباه‌خوانده: لمس عدد درست از خود پیامک (قالب یاد گرفته می‌شود) یا نوشتن مبلغ، جهت و تاریخ */
  evfixopen() {
    const e = curEv(), box = $('#evfix'); if (!e || !box) return;
    if (!box.hidden) { box.hidden = true; return; }
    const nums = Core.smsNums(e.rawText); S.fxIdx = null;
    const chips = nums.map((n, i) => n.replace(/,/g, '').length < 4 ? '' : `<button type="button" class="chip ${Core.smsToman(e.rawText, n) === e.amount ? 'on' : ''}" data-act="fxnum" data-i="${i}">${fa(n)}</button>`).join('');
    box.innerHTML = `${chips ? `<label>مبلغ درست را از خود پیامک لمس کنید</label><div class="chips" id="fxnums">${chips}</div>
      <p class="hint">پیامک‌های بعدیِ همین قالب هم از همین‌جا خوانده می‌شوند.</p>` : ''}
      <label for="fxamt">${chips ? 'یا مبلغ را بنویسید' : 'مبلغ'} (${unitName()})</label><input id="fxamt" inputmode="numeric" autocomplete="off" value="${amtIn(e.amount)}">
      <label>نوع</label><div class="chips" id="fxdir">${[['deposit', 'واریز'], ['withdrawal', 'برداشت']].map(([k, t]) => `<button type="button" class="chip ${e.direction === k ? 'on' : ''}" data-act="fxdir" data-k="${k}">${t}</button>`).join('')}</div>
      <label for="fxdate">تاریخ</label>${dateInput('fxdate', fa(e.date))}
      <div class="err" id="fxerr" role="alert"></div>
      <button type="button" class="primary" data-act="fxsave">ذخیره‌ی اصلاح</button>`;
    box.hidden = false;
    box.onkeydown = ev => { if (ev.key === 'Enter') ev.preventDefault(); }; // Enter این‌جا فرم «تأیید و ثبت» را نفرستد
    $('#fxamt').oninput = ev => { amtTyping(ev); S.fxIdx = null; $('#fxnums .on')?.classList.remove('on'); };
  },
  fxnum(b) {
    const e = curEv(); S.fxIdx = Number(b.dataset.i);
    $('#fxnums .on')?.classList.remove('on'); b.classList.add('on');
    $('#fxamt').value = amtIn(Core.smsToman(e.rawText, Core.smsNums(e.rawText)[S.fxIdx]) ?? 0);
  },
  fxdir(b) { $('#fxdir .on')?.classList.remove('on'); b.classList.add('on'); },
  async fxsave(b) {
    const e = curEv(), err = $('#fxerr'); if (!e || b.disabled) return;
    const amount = readAmt($('#fxamt').value);
    if (S.fxIdx == null && Number.isNaN(amount)) return err.textContent = UNIT_ERR;
    b.disabled = true;
    try {
      const r = await api(`/api/bank-events/${e.id}/fix`, 'POST', { numIndex: S.fxIdx ?? undefined, amount, direction: $('#fxdir .on')?.dataset.k, date: normDate($('#fxdate').value) });
      toast(`اصلاح شد${r.similar ? ` · ${fa(r.similar)} پیامک مشابه هم درست شد` : ''}`);
      await viewInbox(); window.scrollTo(0, 0);
    } catch (x) { b.disabled = false; x.auth ? showAuth(true) : err.textContent = x.msg; }
  },
  async evaddcat() {
    const name = prompt('نام دسته‌ی خنثی تازه');
    if (!name?.trim()) return;
    try { const r = await api('/api/categories', 'POST', { name, type: 'neutral' }); await updateHome(); evExtra('neutral', { purpose: 'neutral', categoryId: r.id }); }
    catch (x) { x.auth ? showAuth(true) : $('#err').textContent = x.msg; }
  },
  evpur(b) { $('#pur').querySelectorAll('.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); evExtra(b.dataset.k); },
  evmatch(b) {
    const accountId = Number($('#eacc').value) || null;
    if (!accountId) return $('#err').textContent = 'حساب بانکی را انتخاب کنید.';
    sendResolve({ purpose: 'match', accountId, transactionId: Number(b.dataset.id) });
  },
  evtpl(b) {
    const t = (S.home.templates ?? []).find(x => x.id === Number(b.dataset.id)); if (!t) return;
    const accountId = Number($('#eacc').value) || null;
    if (!accountId) return $('#err').textContent = 'حساب بانکی را انتخاب کنید.';
    sendResolve({ purpose: isNeutral(t) ? 'neutral' : t.kind, accountId, categoryId: t.categoryId, otherAccountId: null, personId: t.personId ?? null, description: t.description || t.name, transactionId: null });
  },
  async evignore() {
    if (!confirm('این پیامک نادیده گرفته شود؟ وارد دفتر نمی‌شود.\n\nاگر می‌خواهید ثبتش کنید، رد نکنید؛ از دکمه‌های ثبت آماده یا «تأیید و ثبت» همین کارت استفاده کنید. ثبت دستیِ جداگانه باعث می‌شود کنترل مانده با بانک درست کار نکند.')) return;
    try { await api(`/api/bank-events/${curEv().id}/ignore`, 'POST'); await nextEvents(); }
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
