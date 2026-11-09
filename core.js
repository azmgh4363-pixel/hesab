'use strict';
/* هسته‌ی برنامه روی گوشی: همان قواعد نسخه‌ی سرور (src/Ledger.cs و src/BankEvents.cs).
   همه‌ی اطلاعات رمزگذاری‌شده (AES-GCM با کلید PBKDF2) در IndexedDB است و چیزی به بیرون فرستاده نمی‌شود. */
const Core = (() => {
  const MAX = 1e15, ITER = 600000, RECORD = 'state';
  const bad = msg => ({ bad: true, msg });
  let S = null, key = null, salt = null, chain = Promise.resolve();

  /* ---------- تاریخ شمسی ---------- */
  const LEAP = [1, 5, 9, 13, 17, 22, 26, 30];
  const isLeap = y => LEAP.includes(y % 33);
  const monthDays = (y, m) => m <= 6 ? 31 : m <= 11 ? 30 : isLeap(y) ? 30 : 29;
  const p2 = n => String(n).padStart(2, '0');
  const fmt = (y, m, d) => `${String(y).padStart(4, '0')}/${p2(m)}/${p2(d)}`;
  const parts = s => [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8)];
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return false;
    const [y, m, d] = parts(s);
    return y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= monthDays(y, m);
  }
  function addDay(s, n) {
    let [y, m, d] = parts(s);
    d += n;
    if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = monthDays(y, m); }
    else if (d > monthDays(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } }
    return fmt(y, m, d);
  }
  function todayJ(at = new Date()) {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)) p[x.type] = x.value;
    return fmt(+p.year, +p.month, +p.day);
  }

  /* ---------- خواندن پیامک: مبلغ بی‌واحد ریال است ---------- */
  const BANKS = 'ملی|ملت|صادرات|تجارت|سپه|پارسیان|پاسارگاد|سامان|رسالت|کشاورزی|مسکن|رفاه|شهر|دی|آینده|اقتصاد نوین|سینا|توسعه|خاورمیانه|مهر ایران|گردشگری';
  const STOP = new Set(('بانک ایران حساب کارت شماره مبلغ ریال تومان مانده موجودی واریز برداشت بستانکار بدهکار خرید پرداخت کارمزد انتقال تاریخ ساعت پیگیری مرجع سند شناسه از به در با و ' + BANKS.replace(/\|/g, ' ')).split(' '));
  function normalize(t) {
    return String(t).replace(/[۰-۹]/g, c => c.charCodeAt(0) - 0x6F0).replace(/[٠-٩]/g, c => c.charCodeAt(0) - 0x660)
      .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[٬،]/g, ',').replace(/[−–]/g, '-').replace(/‌/g, ' ').replace(/：/g, ':')
      .replace(/[‎‏‪-‮]/g, '').trim();
  }
  const sensitive = s => /رمز\s*(پویا|یکبار|دوم|عبور)|کد\s*(تایید|تأیید|ورود|فعال|امنیتی)|\botp\b|one.?time/i.test(s);
  const num = s => { const v = Number(s.replace(/,/g, '')); return Number.isSafeInteger(v) ? v : null; };

  function parseSms(text, today) {
    const s = normalize(text);
    if (!s || sensitive(s)) return null;
    let w = s;
    const cut = m => { w = w.slice(0, m.index) + ' ' + w.slice(m.index + m[0].length); };
    let date = today, time = null, m = /(?<!\d)(\d{2,4})[/\-](\d{1,2})[/\-](\d{1,2})(?![\d:])/.exec(w);
    if (m) {
      const y = m[1].length === 4 ? m[1] : '14' + m[1].padStart(2, '0').slice(-2);
      date = `${y}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
      cut(m);
    } else {
      m = /(?<![\d,/])(\d{2})[/\-]?(\d{2})\s*[-_ ]\s*(?=\d{1,2}:\d{2})/.exec(w) || /(?<![\d,/])(\d{2})\/(\d{2})(?![\d/])/.exec(w);
      if (m) {
        date = `${today.slice(0, 4)}/${m[1]}/${m[2]}`;
        if (date > today) date = (+today.slice(0, 4) - 1) + date.slice(4); // پیامک اسفند که در فروردین خوانده شود
        cut(m);
      }
    }
    if (!validDate(date)) date = today;
    m = /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/.exec(w);
    if (m) { time = `${m[1].padStart(2, '0')}:${m[2]}`; cut(m); }

    const toman = s.includes('تومان');
    const unit = v => toman ? v : Math.floor((v + 5) / 10);
    let balance = null, reference = null, tail = null;
    m = /(?:مانده|موجودی)[^\d\n]{0,20}(\d[\d,]*)/.exec(w);
    if (m) { const v = num(m[1]); balance = v === null ? null : unit(v); cut(m); }
    m = /(?:پیگیری|مرجع|سند|شناسه)[^\d\n]{0,15}(\d{4,})/.exec(w);
    if (m) { reference = m[1]; cut(m); }
    m = /\d*[*xX.]{2,}\d+/.exec(w);
    if (m) { tail = m[0].replace(/\D/g, ''); cut(m); }

    let sign = null, word = null, value = null;
    m = /(واریز|بستانکار|برداشت|بدهکار|خرید|پرداخت|کارمزد|انتقال|مبلغ)[^\d\n+\-]{0,25}([+\-]?)\s*(\d[\d,]*)\s*([+\-]?)(?!\d)/.exec(w);
    if (m) { word = m[1]; value = num(m[3]); sign = m[2] + m[4]; cut(m); }
    else if ((m = /(?<![\d,])([+\-])\s*(\d[\d,]{3,})/.exec(w))) { sign = m[1]; value = num(m[2]); cut(m); }
    else if ((m = /(?<![\d,])(\d[\d,]{3,})\s*([+\-])(?!\d)/.exec(w))) { sign = m[2]; value = num(m[1]); cut(m); }
    if (!value || value <= 0) return null;

    let dir = null;
    if (sign === '+') dir = 'deposit';
    else if (sign === '-') dir = 'withdrawal';
    else if (word === 'واریز' || word === 'بستانکار') dir = 'deposit';
    else if (['برداشت', 'بدهکار', 'خرید', 'پرداخت', 'کارمزد'].includes(word)) dir = 'withdrawal';
    else if (/واریز|بستانکار|دریافت/.test(s)) dir = 'deposit';
    else if (/برداشت|بدهکار|خرید|پرداخت|کارمزد/.test(s)) dir = 'withdrawal';
    if (!dir) return null;

    m = /(?<![\d,])\d{9,}(?![\d,])/.exec(w);
    if (tail === null && m) { tail = m[0]; cut(m); }
    if (tail && tail.length > 4) tail = tail.slice(-4);
    const bank = new RegExp(`بانک\\s*(${BANKS})`).exec(s)?.[1] ?? null;
    const words = w.replace(/[\d\p{P}\p{S}\s_]+/gu, ' ').split(' ').filter(x => x && !STOP.has(x));
    return { direction: dir, amount: unit(value), date, time, balance, reference, tail, bank, key: words.join(' ').slice(0, 60) };
  }

  /* ---------- دفتر ---------- */
  function fresh() {
    let id = 0;
    const cat = (name, type, nature = 'pnl', code = null) => ({ id: ++id, name, type, nature, code, archived: 0 });
    const categories = [...['حقوق', 'فروش', 'سایر درآمدها'].map(n => cat(n, 'income')),
      ...['خوراک', 'رفت‌وآمد', 'خانه', 'قبض‌ها', 'درمان', 'کارمزد بانکی', 'سایر هزینه‌ها'].map(n => cat(n, 'expense')),
      cat('دریافت طلب', 'income', 'balance', 'receivable_in'), cat('دریافت قرض', 'income', 'balance', 'loan_in'),
      cat('برگشت وجه', 'income', 'refund', 'refund'), cat('سایر واریزها', 'income', 'balance', 'other_in'),
      cat('پرداخت بدهی', 'expense', 'balance', 'debt_out'), cat('پرداخت قرض', 'expense', 'balance', 'loan_out'),
      cat('برداشت شخصی', 'expense', 'balance', 'personal'), cat('سایر برداشت‌ها', 'expense', 'balance', 'other_out')];
    return { v: 1, seq: id + 1, categories, tx: [], entries: [], events: [], rules: [], audit: [], lastBackup: null,
      accounts: [{ id: id + 1, name: 'کیف پول', kind: 'cash', bankName: null, accountNumber: null, openingBalance: 0, archived: 0 }] };
  }
  const nextId = () => ++S.seq + 1000;
  const audit = (action, entity, id, before, after) => S.audit.push({ at: new Date().toISOString(), action, entity, id, before: before ?? null, after: after ?? null });
  const account = id => S.accounts.find(a => a.id === id);
  const live = id => { const t = S.tx.find(x => x.id === id && !x.deletedAt); if (!t) throw bad('تراکنش پیدا نشد.'); return t; };

  function validate(t) {
    if (!['income', 'expense', 'transfer'].includes(t.kind)) throw bad('نوع تراکنش نامعتبر است.');
    if (!validDate(t.date)) throw bad('تاریخ نامعتبر است.');
    if (!Number.isSafeInteger(t.amount) || t.amount <= 0 || t.amount > MAX) throw bad('مبلغ باید بیشتر از صفر باشد.');
    if (!account(t.accountId)) throw bad('حساب پیدا نشد.');
    if (t.kind === 'transfer') {
      if (!account(t.toAccountId)) throw bad('حساب مقصد را انتخاب کنید.');
      if (t.toAccountId === t.accountId) throw bad('حساب مبدأ و مقصد نباید یکی باشند.');
    } else if (!S.categories.some(c => c.id === t.categoryId && c.type === t.kind)) throw bad('دسته را انتخاب کنید.');
  }
  /* هر تراکنش ردیف‌های با جمع صفر می‌سازد. انتقال دو ردیف حساب دارد و به درآمد و هزینه نمی‌رسد. */
  function post(id, t) {
    const row = (accountId, categoryId, amount) => S.entries.push({ txId: id, accountId, categoryId, amount });
    if (t.kind === 'income') { row(t.accountId, null, t.amount); row(null, t.categoryId, -t.amount); }
    else if (t.kind === 'expense') { row(t.accountId, null, -t.amount); row(null, t.categoryId, t.amount); }
    else { row(t.accountId, null, -t.amount); row(t.toAccountId, null, t.amount); }
  }
  const clean = t => ({ kind: t.kind, date: t.date, amount: t.amount, accountId: t.accountId, toAccountId: t.kind === 'transfer' ? t.toAccountId : null,
    categoryId: t.kind === 'transfer' ? null : t.categoryId, description: t.description ?? null, notes: t.notes ?? null, method: t.method ?? null });
  function insertTx(t) {
    validate(t);
    const id = nextId(), row = { id, clientId: t.clientId ?? null, ...clean(t), createdAt: new Date().toISOString(), deletedAt: null };
    S.tx.push(row); post(id, row); audit('create', 'transaction', id, null, row);
    return id;
  }
  function addTx(t) {
    if (t.clientId) { const old = S.tx.find(x => x.clientId === t.clientId); if (old) return { id: old.id, duplicate: true }; }
    return { id: insertTx(t), duplicate: false };
  }
  function updateTx(id, t) {
    const row = live(id), before = { ...row };
    validate(t);
    Object.assign(row, clean(t));
    S.entries = S.entries.filter(e => e.txId !== id);
    post(id, row); audit('update', 'transaction', id, before, row);
  }
  function deleteTx(id) {
    const row = live(id), before = { ...row };
    row.deletedAt = new Date().toISOString();
    S.entries = S.entries.filter(e => e.txId !== id);
    for (const e of S.events) if (e.transactionId === id) { // پیامکِ وصل دوباره منتظر تعیین تکلیف می‌شود؛ کارمزدی که با آن ثبت شده هم پاک می‌شود
      const fee = e.feeTxId; Object.assign(e, { status: 'pending', transactionId: null, feeTxId: null });
      if (fee && S.tx.some(t => t.id === fee && !t.deletedAt)) deleteTx(fee);
    }
    audit('delete', 'transaction', id, before, null);
  }
  const balance = a => a.openingBalance + S.entries.reduce((s, e) => e.accountId === a.id ? s + e.amount : s, 0);
  function txRows({ q, kind, accountId, from, to } = {}, limit = 100) {
    accountId = Number(accountId) || null;
    const cat = id => S.categories.find(c => c.id === id)?.name ?? null, name = id => account(id)?.name ?? null;
    const text = q?.trim();
    return S.tx.filter(t => !t.deletedAt && (!kind || t.kind === kind) && (!accountId || t.accountId === accountId || t.toAccountId === accountId)
      && (!from || t.date >= from) && (!to || t.date <= to)
      && (!text || `${t.description ?? ''} ${t.notes ?? ''} ${cat(t.categoryId) ?? ''}`.includes(text)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, limit)
      .map(t => ({ ...t, accountName: name(t.accountId), toAccountName: name(t.toAccountId), categoryName: cat(t.categoryId) }));
  }
  /* صورت‌حساب یک حساب: قدیمی به جدید جمع می‌شود و جدید به قدیمی نمایش داده می‌شود. */
  function statement(id) {
    const a = account(id); if (!a) throw bad('حساب پیدا نشد.');
    let run = a.openingBalance;
    const rows = txRows({ accountId: id }, Infinity).reverse().map(t => {
      const delta = S.entries.reduce((s, x) => x.txId === t.id && x.accountId === id ? s + x.amount : s, 0);
      run += delta; return { ...t, delta, balance: run };
    }).reverse();
    return { account: { ...a, balance: run }, opening: a.openingBalance, rows, check: balanceChecks().find(c => c.accountId === id) ?? null };
  }
  /* کنترل مانده: مانده‌ی آخرین پیامکِ تعیین‌تکلیف‌شده باید با مانده‌ی برنامه در پایان همان روز یکی باشد. */
  function balanceChecks() {
    const out = [];
    for (const a of S.accounts.filter(x => x.kind === 'bank' && !x.archived)) {
      const evs = S.events.filter(e => e.accountId === a.id && e.balance != null && e.status !== 'pending')
        .sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? '').localeCompare(y.time ?? '') || x.id - y.id);
      if (!evs.length) continue;
      const last = evs[evs.length - 1];
      const ids = new Set(S.tx.filter(t => !t.deletedAt && t.date <= last.date).map(t => t.id));
      const app = a.openingBalance + S.entries.reduce((s, x) => x.accountId === a.id && ids.has(x.txId) ? s + x.amount : s, 0);
      const waiting = S.events.some(e => e.status === 'pending' && (e.accountId === a.id || e.accountId == null) && e.date <= last.date);
      out.push({ accountId: a.id, name: a.name, date: last.date, time: last.time ?? null, bank: last.balance, app, diff: last.balance - app, waiting });
    }
    return out;
  }
  const accounts = () => S.accounts.filter(a => !a.archived).map(a => ({ ...a, balance: balance(a) })).sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
  const categories = () => {
    const use = c => S.tx.filter(t => t.categoryId === c.id && !t.deletedAt).length;
    return S.categories.filter(c => !c.archived).map(c => [use(c), c]).sort((a, b) => b[0] - a[0] || a[1].id - b[1].id).map(x => x[1]);
  };
  function checkAccount(a) {
    if (!a.name?.trim()) throw bad('نام حساب را وارد کنید.');
    if (!['cash', 'bank'].includes(a.kind)) throw bad('نوع حساب نامعتبر است.');
    if (!Number.isSafeInteger(a.openingBalance) || Math.abs(a.openingBalance) > MAX) throw bad('موجودی اولیه نامعتبر است.');
  }
  function home(today) {
    const [from, to] = [today.slice(0, 7) + '/01', today.slice(0, 7) + '/31'];
    const sum = (kind, nature) => S.tx.filter(t => !t.deletedAt && t.kind === kind && t.date >= from && t.date <= to
      && S.categories.find(c => c.id === t.categoryId)?.nature === nature).reduce((s, t) => s + t.amount, 0);
    const income = sum('income', 'pnl'), expense = sum('expense', 'pnl') - sum('income', 'refund'), list = accounts();
    const total = k => list.filter(a => a.kind === k).reduce((s, a) => s + a.balance, 0);
    const live = S.tx.some(t => !t.deletedAt);
    const backupDue = live && (!S.lastBackup || Date.now() - S.lastBackup > 7 * 864e5);
    return { today, cash: total('cash'), bank: total('bank'), income, expense, net: income - expense, backupDue, lastBackup: S.lastBackup,
      pending: S.events.filter(e => e.status === 'pending').length, accounts: list, categories: categories(), recent: txRows({}, 8), checks: balanceChecks() };
  }

  /* ---------- صندوق پیامک: بدون تأیید کاربر چیزی وارد دفتر نمی‌شود ---------- */
  const DEP = { receivable: 'receivable_in', loan: 'loan_in', refund: 'refund', other: 'other_in' };
  const WD = { debt: 'debt_out', loan: 'loan_out', personal: 'personal', other: 'other_out' };
  function guessAccount(p) {
    const banks = S.accounts.filter(a => a.kind === 'bank' && !a.archived);
    if (p.tail) { const h = banks.filter(a => a.accountNumber && normalize(a.accountNumber).endsWith(p.tail)); if (h.length === 1) return h[0].id; }
    if (p.bank) { const h = banks.filter(a => a.bankName && normalize(a.bankName).includes(p.bank)); if (h.length === 1) return h[0].id; }
    return banks.length === 1 ? banks[0].id : null;
  }
  function ingest(text, today) {
    if (String(text).length > 2000) throw bad('متن خیلی بلند است.');
    const p = parseSms(text, today);
    if (!p) throw bad('این متن به‌عنوان پیامک تراکنش بانکی خوانده نشد.');
    const norm = normalize(text).replace(/\s+/g, ' ');
    const old = S.events.find(e => e.norm === norm);
    if (old) return { id: old.id, duplicate: true };
    const id = nextId();
    S.events.push({ id, norm, rawText: String(text).trim(), accountId: guessAccount(p), direction: p.direction, amount: p.amount, date: p.date, time: p.time,
      balance: p.balance, reference: p.reference, matchKey: p.key, status: 'pending', transactionId: null, receivedAt: new Date().toISOString() });
    return { id, duplicate: false };
  }
  /* فایل Shortcuts: هر پیامک با خط ### شروع می‌شود و بعد از آن می‌تواند زمان رسیدن پیامک بیاید. */
  function splitSmsFile(text) {
    const blocks = []; let cur = null;
    for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const h = line.match(/^\s*#{3,}\s*(.*)$/);
      if (h) blocks.push(cur = { at: h[1].trim(), lines: [] });
      else { if (!cur) blocks.push(cur = { at: '', lines: [] }); cur.lines.push(line); }
    }
    return blocks.map(b => ({ at: b.at, text: b.lines.join('\n').trim() })).filter(b => b.text);
  }
  function ingestFile(text) {
    if (String(text).length > 2000000) throw bad('فایل خیلی بزرگ است.');
    const r = { added: 0, duplicate: 0, skipped: 0 };
    for (const b of splitSmsFile(text)) {
      const at = new Date(b.at);
      try { ingest(b.text, b.at && !isNaN(at) ? todayJ(at) : todayJ()).duplicate ? r.duplicate++ : r.added++; }
      catch (e) { if (!e.bad) throw e; r.skipped++; }
    }
    return r;
  }
  /* کارمزد انتقال: اختلاف برداشت و واریزِ یک انتقال، حداکثر ۱٪ مبلغ و ۵۰٬۰۰۰ تومان */
  const feeLimit = amount => Math.min(Math.floor(amount / 100), 50000);
  function matches(e, accountId) {
    const from = addDay(e.date, -1), to = addDay(e.date, 1), dep = e.direction === 'deposit';
    const mine = id => !accountId || id === accountId;
    return S.tx.filter(t => !t.deletedAt && t.date >= from && t.date <= to && !S.events.some(b => b.transactionId === t.id && b.direction === e.direction))
      .map(t => {
        let fee = null;
        if (t.amount === e.amount) {
          if (dep ? (t.kind === 'income' && mine(t.accountId)) || (t.kind === 'transfer' && mine(t.toAccountId))
            : ['expense', 'transfer'].includes(t.kind) && mine(t.accountId)) fee = 0;
        } else if (t.kind === 'transfer' && (dep ? mine(t.toAccountId) : mine(t.accountId))) {
          const diff = dep ? t.amount - e.amount : e.amount - t.amount;
          if (diff > 0 && diff <= feeLimit(Math.max(t.amount, e.amount))) fee = diff;
        }
        return fee === null ? null : { ...t, fee, categoryName: S.categories.find(c => c.id === t.categoryId)?.name ?? null };
      }).filter(Boolean)
      .sort((a, b) => a.fee - b.fee || b.date.localeCompare(a.date) || b.id - a.id).slice(0, 5);
  }
  function feeCategory() {
    let c = S.categories.find(x => x.type === 'expense' && x.nature === 'pnl' && x.name === 'کارمزد بانکی');
    if (!c) S.categories.push(c = { id: nextId(), name: 'کارمزد بانکی', type: 'expense', nature: 'pnl', code: null, archived: 0 });
    return c.id;
  }
  /* انتقال، مبلغ واریزشده را می‌گیرد و اختلاف، هزینه‌ی کارمزد از حساب مبدأ می‌شود. */
  function chargeFee(m, e) {
    if (e.direction === 'deposit') updateTx(m.id, { ...live(m.id), amount: e.amount });
    return insertTx({ kind: 'expense', date: m.date, amount: m.fee, accountId: m.accountId, categoryId: feeCategory(), description: 'کارمزد انتقال' });
  }
  const pending = () => S.events.filter(e => e.status === 'pending').sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(e => ({
    ...e, matches: matches(e, e.accountId),
    suggestion: e.matchKey ? S.rules.find(r => r.key === e.matchKey && r.direction === e.direction) ?? null : null }));
  function buildTx(x, e, acc) {
    const dep = e.direction === 'deposit', base = { date: e.date, amount: e.amount, description: x.description ?? null };
    if (x.purpose === 'transfer') {
      if (!x.otherAccountId) throw bad('حساب دیگر را انتخاب کنید.');
      return { ...base, kind: 'transfer', accountId: dep ? x.otherAccountId : acc, toAccountId: dep ? acc : x.otherAccountId, method: 'انتقال بانکی' };
    }
    const kind = dep ? 'income' : 'expense';
    if (x.purpose === kind) return { ...base, kind, accountId: acc, categoryId: x.categoryId };
    const code = (dep ? DEP : WD)[x.purpose];
    if (!code) throw bad('نوع انتخاب‌شده با این تراکنش جور نیست.');
    return { ...base, kind, accountId: acc, categoryId: S.categories.find(c => c.code === code).id };
  }
  function resolve(id, x) {
    const e = S.events.find(v => v.id === id && v.status === 'pending');
    if (!e) throw bad('این تراکنش قبلاً تعیین تکلیف شده است.');
    if (!x.accountId) throw bad('حساب بانکی را انتخاب کنید.');
    let txId, feeTxId = null;
    if (x.purpose === 'match') {
      const m = matches(e, x.accountId).find(v => v.id === x.transactionId);
      if (!m) throw bad('این تراکنش با پیامک بانک هم‌خوان نیست.');
      txId = m.id;
      if (m.fee) feeTxId = chargeFee(m, e);
    } else txId = insertTx(buildTx(x, e, x.accountId));
    Object.assign(e, { status: 'confirmed', transactionId: txId, feeTxId, accountId: x.accountId });
    if (x.purpose !== 'match' && e.matchKey) {
      let r = S.rules.find(v => v.key === e.matchKey && v.direction === e.direction);
      if (!r) S.rules.push(r = { key: e.matchKey, direction: e.direction, count: 0 });
      r.count = r.purpose === x.purpose ? r.count + 1 : 1;
      Object.assign(r, { purpose: x.purpose, categoryId: x.categoryId ?? null, otherAccountId: x.otherAccountId ?? null });
    }
    audit('confirm', 'bank_event', id, null, x);
  }

  /* ---------- قفل و ذخیره ---------- */
  const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(password, sl, iter) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sl, iterations: iter, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(S)));
    return { app: 'hesab-man', format: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: chunked(new Uint8Array(data)) };
  }
  function chunked(u) { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }
  async function open(rec, password) {
    const sl = unb64(rec.salt), k = await derive(password, sl, rec.iter);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, k, unb64(rec.data)); }
    catch { throw bad('رمز اشتباه است.'); }
    return { state: JSON.parse(new TextDecoder().decode(plain)), k, sl };
  }
  const save = async () => storage.set(RECORD, await seal());
  /* تغییرها یکی‌یکی اجرا می‌شوند؛ خطا یا ناموفق بودن ذخیره، همه‌چیز را برمی‌گرداند. */
  function commit(fn) {
    const run = async () => {
      const snap = JSON.stringify(S);
      try { const r = fn(); await save(); return r; }
      catch (e) { S = JSON.parse(snap); if (e?.bad) throw e; throw bad('ذخیره روی گوشی انجام نشد؛ دوباره امتحان کنید.'); }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => { });
    return p;
  }

  const storage = {
    db: null,
    async conn() {
      return this.db ??= await new Promise((ok, no) => {
        const r = indexedDB.open('hesab-man', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
      });
    },
    async get(k) { const d = await this.conn(); return new Promise((ok, no) => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result ?? null); r.onerror = () => no(r.error); }); },
    async set(k, v) { const d = await this.conn(); return new Promise((ok, no) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = t.onabort = () => no(t.error); }); }
  };

  async function setup(password) {
    if (await storage.get(RECORD)) throw bad('برنامه قبلاً راه‌اندازی شده است.');
    if (!password || password.length < 6) throw bad('رمز باید حداقل ۶ حرف باشد.');
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(password, salt, ITER);
    S = fresh();
    await save();
    globalThis.navigator?.storage?.persist?.().catch(() => { });
  }
  async function unlock(password) {
    const rec = await storage.get(RECORD);
    if (!rec) throw bad('اطلاعاتی روی این گوشی نیست.');
    const o = await open(rec, password);
    S = o.state; key = o.k; salt = o.sl;
  }
  function lock() { S = null; key = null; salt = null; }
  /* تغییر رمز: همه‌ی اطلاعات با کلید تازه ذخیره می‌شود؛ اگر ذخیره نشود رمز قبلی می‌ماند. */
  async function changePassword(oldPassword, newPassword) {
    if (!S) throw { auth: true, msg: 'برنامه قفل است.' };
    if (!newPassword || newPassword.length < 6) throw bad('رمز تازه باید حداقل ۶ حرف باشد.');
    if (newPassword === oldPassword) throw bad('رمز تازه با رمز فعلی یکی است.');
    const run = async () => {
      try { await open(await storage.get(RECORD), oldPassword); } catch (e) { throw e?.bad ? bad('رمز فعلی اشتباه است.') : e; }
      const ns = crypto.getRandomValues(new Uint8Array(16)), nk = await derive(newPassword, ns, ITER);
      const old = [salt, key, S.lastBackup];
      salt = ns; key = nk; S.lastBackup = null; // پشتیبان‌های قبلی رمز قبلی را دارند
      try { await save(); } catch { [salt, key, S.lastBackup] = old; throw bad('ذخیره روی گوشی انجام نشد؛ رمز عوض نشد.'); }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => { });
    return p;
  }
  async function exportBackup() {
    await commit(() => { S.lastBackup = Date.now(); });
    return JSON.stringify(await seal());
  }
  /* اطلاعات فعلی گوشی با فایل جایگزین می‌شود؛ رمز همان رمز زمان ساخت پشتیبان است. */
  async function importBackup(text, password) {
    let rec;
    try { rec = JSON.parse(text); } catch { throw bad('این فایل پشتیبان برنامه نیست.'); }
    if (rec?.app !== 'hesab-man') throw bad('این فایل پشتیبان برنامه نیست.');
    const o = await open(rec, password);
    S = o.state; key = o.k; salt = o.sl;
    await storage.set(RECORD, rec);
  }

  /* همان مسیرهای API نسخه‌ی سرور، تا ظاهر برنامه دست نخورد. */
  async function handle(path, method = 'GET', body) {
    const url = new URL(path, 'http://x'), p = url.pathname;
    if (p === '/api/auth/state') return { hasUser: !!(await storage.get(RECORD)), loggedIn: !!S };
    if (p === '/api/auth/setup') return setup(body.password);
    if (p === '/api/auth/login') return unlock(body.password);
    if (!S) throw { auth: true, msg: 'برنامه قفل است.' };
    const id = Number(p.split('/')[3]);
    if (p === '/api/home') return home(todayJ());
    if (p === '/api/transactions' && method === 'GET') return txRows(Object.fromEntries(url.searchParams));
    if (p === '/api/transactions') return commit(() => addTx(body));
    if (p.startsWith('/api/transactions/')) return commit(() => method === 'PUT' ? updateTx(id, body) : deleteTx(id));
    if (p === '/api/accounts') return commit(() => {
      checkAccount(body);
      const a = { id: nextId(), name: body.name.trim(), kind: body.kind, bankName: body.bankName, accountNumber: body.accountNumber, openingBalance: body.openingBalance, archived: 0 };
      S.accounts.push(a); audit('create', 'account', a.id, null, a); return { id: a.id };
    });
    if (p.startsWith('/api/accounts/') && p.endsWith('/statement')) return statement(id);
    if (p.startsWith('/api/accounts/')) return commit(() => {
      const a = account(id); if (!a) throw bad('حساب پیدا نشد.');
      if (method === 'PUT') { checkAccount(body); const before = { ...a }; Object.assign(a, { name: body.name.trim(), kind: body.kind, bankName: body.bankName, accountNumber: body.accountNumber, openingBalance: body.openingBalance }); audit('update', 'account', id, before, a); }
      else { if (balance(a) !== 0) throw bad('حساب مانده دارد؛ اول مانده را صفر کنید.'); a.archived = 1; audit('archive', 'account', id); }
    });
    if (p === '/api/categories') return commit(() => {
      if (!body.name?.trim()) throw bad('نام دسته را وارد کنید.');
      if (!['income', 'expense'].includes(body.type)) throw bad('نوع دسته نامعتبر است.');
      const c = { id: nextId(), name: body.name.trim(), type: body.type, nature: 'pnl', code: null, archived: 0 };
      S.categories.push(c); audit('create', 'category', c.id, null, c); return { id: c.id };
    });
    if (p.startsWith('/api/categories/')) return commit(() => {
      const c = S.categories.find(x => x.id === id && !x.code); if (!c) throw bad('این دسته قابل حذف نیست.');
      c.archived = 1; audit('archive', 'category', id);
    });
    if (p === '/api/bank-events') return pending();
    if (p === '/api/bank-events/paste') return commit(() => ingest(body.text ?? '', todayJ()));
    if (p === '/api/bank-events/import') return commit(() => ingestFile(body.text ?? ''));
    if (p.endsWith('/resolve')) return commit(() => resolve(id, body));
    if (p.endsWith('/ignore')) return commit(() => {
      const e = S.events.find(v => v.id === id && v.status === 'pending'); if (!e) throw bad('این تراکنش قبلاً تعیین تکلیف شده است.');
      e.status = 'ignored'; audit('ignore', 'bank_event', id);
    });
    throw bad('درخواست نامعتبر است.');
  }

  return { handle, lock, changePassword, exportBackup, importBackup, storage, parseSms, validDate, addDay, todayJ, home: t => home(t), state: () => S };
})();
if (typeof module !== 'undefined') module.exports = Core;
