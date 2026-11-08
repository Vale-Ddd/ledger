'use strict';

/* ============================================================
   工具函数
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAY = 24 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function addMonths(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 分 -> ¥1,234.56 */
function fmtMoney(cents) {
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = String(abs % 100).padStart(2, '0');
  const yuanStr = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${yuanStr}.${fen}`;
}

/** 图表用的短金额：¥1.2k / ¥1.2万 */
function shortMoney(cents) {
  const yuan = Math.round(cents / 100);
  if (yuan >= 10000) return `¥${(yuan / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  if (yuan >= 1000) return `¥${(yuan / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `¥${yuan}`;
}

function parseAmountToCents(str) {
  if (!str) return 0;
  const n = Number(String(str).replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  const cents = Math.round(n * 100);
  return cents > 0 ? cents : 0;
}

function sum(list) {
  return list.reduce((s, r) => s + r.amount, 0);
}

function uuid() {
  if (window.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-');
  return `${y}年${Number(m)}月`;
}

function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  if (dateStr === todayStr()) return `今天 · ${m}月${d}日`;
  const yearPrefix = y !== new Date().getFullYear() ? `${y}年` : '';
  return `${yearPrefix}${m}月${d}日 ${wd}`;
}

function formatDateFromTs(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ============================================================
   常量与状态
   ============================================================ */
const DEFAULT_CATEGORIES = {
  exp: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '学习', '其他'],
  inc: ['工资', '兼职', '理财', '红包', '其他'],
};

const PALETTE = [
  '#d97757', '#b98a4b', '#8a9a5b', '#b5838d', '#7f8ea3',
  '#c17f59', '#6b8e8a', '#a5947c', '#9b7bb0', '#c4806c',
];

const BACKUP_REMIND_MS = 7 * DAY;

let db = null;
let records = [];
let categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
let currentMonth = monthOf(todayStr());
let lastBackupAt = 0;
let bannerDismissed = false;

let editingId = null;
let entryType = 'exp';
let selectedCategory = null;
let addCategoryType = null;
let swReg = null;

/* ============================================================
   IndexedDB
   ============================================================ */
const DB_NAME = 'ledger-db';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains('records')) {
        const store = database.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function getAllRecords() {
  return idbReq(store('records').getAll());
}

function putRecord(rec) {
  return idbReq(store('records', 'readwrite').put(rec));
}

function deleteRecord(id) {
  return idbReq(store('records', 'readwrite').delete(id));
}

async function getMeta(key, fallback) {
  const row = await idbReq(store('meta').get(key));
  return row ? row.value : fallback;
}

function setMeta(key, value) {
  return idbReq(store('meta', 'readwrite').put({ key, value }));
}

/* ============================================================
   Toast
   ============================================================ */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ============================================================
   弹层
   ============================================================ */
function showSheet(selector) {
  $(selector).hidden = false;
  document.body.classList.add('locked');
}

function closeSheet(selector) {
  $(selector).hidden = true;
  if ($('#entry-backdrop').hidden && $('#settings-backdrop').hidden) {
    document.body.classList.remove('locked');
  }
}

/* ============================================================
   渲染
   ============================================================ */
function recordsInMonth(monthKey) {
  return records.filter((r) => monthOf(r.date) === monthKey);
}

function renderAll() {
  renderMonthLabel();
  renderSummary();
  renderRatio();
  renderTrend();
  renderRecords();
  renderBanner();
  renderSettingsMeta();
}

function renderMonthLabel() {
  $('#month-label').textContent = formatMonthLabel(currentMonth);
}

function renderSummary() {
  const list = recordsInMonth(currentMonth);
  const expense = sum(list.filter((r) => r.type === 'exp'));
  const income = sum(list.filter((r) => r.type === 'inc'));
  const balance = income - expense;

  const expEl = $('#summary-expense');
  expEl.textContent = fmtMoney(expense);
  expEl.classList.toggle('is-zero', expense === 0);

  $('#summary-income').textContent = fmtMoney(income);
  $('#summary-balance').textContent = (balance < 0 ? '−' : '') + fmtMoney(balance);
  $('#summary-balance-wrap').classList.toggle('neg', balance < 0);
}

function renderRatio() {
  const holder = $('#ratio-content');
  const list = recordsInMonth(currentMonth).filter((r) => r.type === 'exp');
  const total = sum(list);

  if (!total) {
    holder.innerHTML = '<div class="ratio-empty">这个月还没有支出记录</div>';
    return;
  }

  const grouped = new Map();
  list.forEach((r) => {
    grouped.set(r.category, (grouped.get(r.category) || 0) + r.amount);
  });

  let items = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
  const MAX_LEGEND = 6;
  if (items.length > MAX_LEGEND) {
    const rest = items.slice(MAX_LEGEND).reduce((s, item) => s + item[1], 0);
    items = items.slice(0, MAX_LEGEND);
    if (rest > 0) items.push(['其他', rest]);
  }

  let acc = 0;
  const stops = items.map(([, value], i) => {
    const start = (acc / total) * 100;
    acc += value;
    const end = (acc / total) * 100;
    const color = PALETTE[i % PALETTE.length];
    return `${color} ${Math.max(0, start - 0.15).toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(', ');

  const legend = items.map(([name, value], i) => {
    const exact = (value / total) * 100;
    const pct = exact >= 1 ? `${Math.round(exact)}%` : '<1%';
    return `<li>
      <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="name">${esc(name)}</span>
      <span class="pct">${pct}</span>
      <span class="val">${fmtMoney(value)}</span>
    </li>`;
  }).join('');

  holder.innerHTML = `
    <div class="ratio">
      <div class="donut-wrap">
        <div class="donut" style="background:conic-gradient(${stops})">
          <div class="donut-center"><em>支出</em>${fmtMoney(total)}</div>
        </div>
      </div>
      <ul class="legend">${legend}</ul>
    </div>`;
}

function renderTrend() {
  const holder = $('#trend');
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(addMonths(currentMonth, -i));
  const values = months.map((m) => sum(recordsInMonth(m).filter((r) => r.type === 'exp')));
  const max = Math.max(...values, 0);

  holder.innerHTML = months.map((m, i) => {
    const value = values[i];
    const pct = max > 0
      ? Math.max((value / max) * 100, value > 0 ? 4 : 1.5)
      : 1.5;
    const label = `${Number(m.slice(5))}月`;
    return `<button class="trend-col${m === currentMonth ? ' on' : ''}" data-month="${m}"
      aria-label="${formatMonthLabel(m)}支出 ${fmtMoney(value)}">
      <span class="trend-val">${value > 0 ? shortMoney(value) : ''}</span>
      <span class="trend-track"><span class="trend-bar" style="height:${pct.toFixed(1)}%"></span></span>
      <span class="trend-label">${label}</span>
    </button>`;
  }).join('');
}

function renderRecords() {
  const holder = $('#record-list');
  const list = recordsInMonth(currentMonth).slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  $('#record-count').textContent = list.length ? `${list.length} 笔` : '';

  if (!list.length) {
    holder.innerHTML = `
      <div class="empty">
        <div class="empty-mark">¥</div>
        <p>这个月还没有记录</p>
        <p class="hint">点右下角的 + 记下第一笔</p>
      </div>`;
    return;
  }

  const groups = new Map();
  list.forEach((r) => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });

  let html = '';
  groups.forEach((items, date) => {
    const expense = sum(items.filter((r) => r.type === 'exp'));
    const income = sum(items.filter((r) => r.type === 'inc'));
    const net = income - expense;
    const netText = (net > 0 ? '+' : net < 0 ? '−' : '') + fmtMoney(net);
    const rows = items.map((r) => `
      <button class="record" data-id="${esc(r.id)}">
        <span class="rec-main">
          <span class="rec-cat">${esc(r.category)}</span>
          ${r.note ? `<span class="rec-note">${esc(r.note)}</span>` : ''}
        </span>
        <span class="rec-amount${r.type === 'inc' ? ' inc' : ''}">${r.type === 'exp' ? '−' : '+'}${fmtMoney(r.amount)}</span>
      </button>`).join('');
    html += `
      <div class="day-group">
        <div class="day-head">
          <span>${formatDayLabel(date)}</span>
          <span class="day-total${net > 0 ? ' inc' : ''}">${net !== 0 ? netText : ''}</span>
        </div>
        ${rows}
      </div>`;
  });

  holder.innerHTML = html;
}

function renderBanner() {
  const el = $('#backup-banner');
  const hasData = records.length > 0;
  const stale = !lastBackupAt || Date.now() - lastBackupAt > BACKUP_REMIND_MS;
  const show = hasData && stale && !bannerDismissed;
  el.hidden = !show;
  if (!show) return;

  const days = Math.floor((Date.now() - lastBackupAt) / DAY);
  $('#banner-text').innerHTML = lastBackupAt
    ? `<strong>已经 ${days} 天没有备份了。</strong>账目只存在这台设备上，建议现在导出一份。`
    : '<strong>还没有备份过。</strong>账目只存在这台设备上，删掉 App 或换手机就没了。';
}

function renderSettingsMeta() {
  const el = $('#backup-status');
  if (!lastBackupAt) {
    el.textContent = '上次备份：从未';
    el.classList.add('warn');
  } else {
    const days = Math.floor((Date.now() - lastBackupAt) / DAY);
    const when = days <= 0 ? '今天' : `${days} 天前`;
    el.textContent = `上次备份：${when} · ${formatDateFromTs(lastBackupAt)}`;
    el.classList.toggle('warn', days > 7);
  }
  $('#total-count').textContent = `${records.length} 笔`;
}

async function renderStorageStatus() {
  const el = $('#storage-status');
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      const persisted = await navigator.storage.persisted();
      el.textContent = persisted ? '已持久化' : '由系统管理';
    } else {
      el.textContent = '由系统管理';
    }
  } catch {
    el.textContent = '未知';
  }
}

/* ============================================================
   记账弹窗
   ============================================================ */
function defaultEntryDate() {
  const today = todayStr();
  if (currentMonth === monthOf(today)) return today;
  const day = Number(today.slice(8, 10));
  const [y, m] = currentMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${currentMonth}-${pad2(Math.min(day, lastDay))}`;
}

function openEntry(record = null) {
  editingId = record ? record.id : null;
  entryType = record ? record.type : 'exp';
  selectedCategory = record ? record.category : (categories[entryType][0] || null);

  $('#entry-title').textContent = record ? '编辑记录' : '记一笔';
  $('#entry-amount').value = record
    ? (record.amount / 100).toFixed(2).replace(/\.00$/, '')
    : '';
  $('#entry-date').value = record ? record.date : defaultEntryDate();
  $('#entry-note').value = record ? record.note : '';
  $('#entry-delete').hidden = !record;

  $$('#type-switch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === entryType);
  });

  renderCategoryChips();
  showSheet('#entry-backdrop');
  $('#entry-backdrop .sheet').scrollTop = 0;
  // 同步聚焦才能在 iOS 上弹出键盘
  $('#entry-amount').focus();
}

function renderCategoryChips() {
  const holder = $('#category-chips');
  const list = [...categories[entryType]];
  if (selectedCategory && !list.includes(selectedCategory)) {
    list.unshift(selectedCategory);
  }

  holder.innerHTML = list.map((name) => `
    <button class="chip${name === selectedCategory ? ' active' : ''}" data-cat="${esc(name)}">${esc(name)}</button>
  `).join('') + '<button class="chip add" id="chip-add">＋ 新分类</button>';
}

function showChipAdd() {
  if ($('#chip-add-input')) {
    $('#chip-add-input').focus();
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'chip-input';
  wrap.innerHTML = `<input type="text" id="chip-add-input" placeholder="分类名称" maxlength="12">
    <button id="chip-add-ok">添加</button>`;
  $('#category-chips').appendChild(wrap);
  const input = $('#chip-add-input');
  input.focus();

  const commit = async () => {
    const name = input.value.trim();
    if (!name) {
      wrap.remove();
      return;
    }
    await addCategory(entryType, name);
    selectedCategory = name.slice(0, 12);
    renderCategoryChips();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  $('#chip-add-ok').addEventListener('click', commit);
}

async function addCategory(type, name) {
  const clean = String(name).trim().slice(0, 12);
  if (!clean) return false;
  if (!categories[type].includes(clean)) {
    categories[type].push(clean);
    await setMeta('categories', categories);
  }
  renderCatManage();
  return true;
}

async function removeCategory(type, name) {
  if (!confirm(`删除分类“${name}”？已经记下的账目不受影响。`)) return;
  categories[type] = categories[type].filter((c) => c !== name);
  await setMeta('categories', categories);
  if (selectedCategory === name) {
    selectedCategory = categories[type][0] || null;
  }
  renderCatManage();
  if (!$('#entry-backdrop').hidden) renderCategoryChips();
}

async function saveEntry() {
  const cents = parseAmountToCents($('#entry-amount').value);
  if (!cents) {
    toast('请输入金额');
    $('#entry-amount').focus();
    return;
  }
  if (!selectedCategory) {
    toast('请先选择或添加一个分类');
    return;
  }
  const date = $('#entry-date').value || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    toast('日期格式不对');
    return;
  }

  const existing = editingId ? records.find((r) => r.id === editingId) : null;
  const rec = {
    id: editingId || uuid(),
    type: entryType,
    amount: cents,
    category: selectedCategory,
    note: $('#entry-note').value.trim(),
    date,
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  await putRecord(rec);
  records = await getAllRecords();

  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  closeSheet('#entry-backdrop');

  currentMonth = monthOf(date);
  renderAll();
  toast(existing ? '已保存' : '记下了');
}

async function deleteEntry() {
  if (!editingId) return;
  if (!confirm('删除这笔记录？')) return;
  await deleteRecord(editingId);
  records = await getAllRecords();
  closeSheet('#entry-backdrop');
  renderAll();
  toast('已删除');
}

/* ============================================================
   设置
   ============================================================ */
function openSettings() {
  renderCatManage();
  renderSettingsMeta();
  renderStorageStatus();
  showSheet('#settings-backdrop');
  $('#settings-backdrop .sheet').scrollTop = 0;
}

function renderCatManage() {
  const makeTags = (type) => categories[type].map((name) => `
    <span class="cat-tag">${esc(name)}<button data-del="${esc(name)}" data-type="${type}"
      aria-label="删除分类 ${esc(name)}">×</button></span>
  `).join('') + `<button class="cat-tag" data-add="${type}" style="background:transparent;border:1px dashed var(--line);padding:6px 12px">＋</button>`;

  $('#cat-exp').innerHTML = makeTags('exp');
  $('#cat-inc').innerHTML = makeTags('inc');
}

function showCategoryAdd(type) {
  addCategoryType = type;
  const row = $('#cat-add-row');
  const group = $(`#cat-${type}`).closest('.cat-group');
  if (group) group.appendChild(row);
  row.hidden = false;
  const input = $('#cat-add-input');
  input.value = '';
  input.placeholder = type === 'exp' ? '新支出分类' : '新收入分类';
  input.focus();
}

async function confirmCategoryAdd() {
  const name = $('#cat-add-input').value.trim();
  if (!name || !addCategoryType) {
    $('#cat-add-row').hidden = true;
    addCategoryType = null;
    return;
  }
  await addCategory(addCategoryType, name);
  $('#cat-add-row').hidden = true;
  $('#cat-add-input').value = '';
  addCategoryType = null;
  toast('分类已添加');
}

/* ============================================================
   导出 / 导入
   ============================================================ */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}

/**
 * iOS PWA 里直接下载不可靠：优先走系统的分享面板（可以存进“文件”或发给自己），
 * 不支持或失败时回退到普通下载。
 * 返回 'shared' | 'downloaded' | 'cancelled' | 'failed'
 */
async function saveFile(filename, blob) {
  let file = null;
  try {
    file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  } catch {
    file = null;
  }

  if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      // 用户主动取消才算取消；其余错误（如桌面端不支持文件分享）回退下载
      if (e && e.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  try {
    downloadBlob(filename, blob);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

async function afterExport(result) {
  if (result === 'cancelled') return;
  if (result === 'failed') {
    toast('导出失败，请换个浏览器再试');
    return;
  }
  lastBackupAt = Date.now();
  await setMeta('lastBackupAt', lastBackupAt);
  renderBanner();
  renderSettingsMeta();
  toast(result === 'shared' ? '已导出备份' : '已下载备份文件');
}

function stamp() {
  return todayStr();
}

async function exportJSON() {
  if (!records.length) {
    toast('还没有账目可以导出');
    return;
  }
  const payload = {
    app: 'ledger',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: records.slice().sort((a, b) => a.date.localeCompare(b.date)),
    categories,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const result = await saveFile(`账本备份-${stamp()}.json`, blob);
  await afterExport(result);
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCSV() {
  if (!records.length) {
    toast('还没有账目可以导出');
    return;
  }
  const rows = [['id', 'type', 'amount', 'category', 'note', 'date', 'createdAt']];
  records
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((r) => {
      rows.push([
        r.id,
        r.type === 'exp' ? '支出' : '收入',
        (r.amount / 100).toFixed(2),
        r.category,
        r.note,
        r.date,
        new Date(r.createdAt || Date.now()).toISOString(),
      ]);
    });
  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const result = await saveFile(`账本-${stamp()}.csv`, blob);
  await afterExport(result);
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.type !== 'exp' && raw.type !== 'inc') return null;

  const amount = Math.round(Number(raw.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
  const [y, m, d] = raw.date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;

  const createdAt = Number(raw.createdAt);
  return {
    id: raw.id,
    type: raw.type,
    amount,
    category: String(raw.category || '其他').slice(0, 20),
    note: String(raw.note || '').slice(0, 100),
    date: raw.date,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
  };
}

async function importJSONFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('文件不是有效的 JSON');
    return;
  }

  const incoming = Array.isArray(data) ? data : data && Array.isArray(data.records) ? data.records : null;
  if (!incoming) {
    toast('文件里没有找到账目数据');
    return;
  }

  const existingIds = new Set(records.map((r) => r.id));
  const toAdd = [];
  let invalid = 0;
  let duplicate = 0;

  incoming.forEach((raw) => {
    const rec = normalizeRecord(raw);
    if (!rec) {
      invalid++;
      return;
    }
    if (existingIds.has(rec.id)) {
      duplicate++;
      return;
    }
    existingIds.add(rec.id);
    toAdd.push(rec);
  });

  if (data && data.categories) {
    ['exp', 'inc'].forEach((type) => {
      if (!Array.isArray(data.categories[type])) return;
      data.categories[type].forEach((name) => {
        if (typeof name !== 'string') return;
        const clean = name.trim().slice(0, 12);
        if (clean && !categories[type].includes(clean)) categories[type].push(clean);
      });
    });
    await setMeta('categories', categories);
  }

  if (toAdd.length) {
    const tx = db.transaction('records', 'readwrite');
    const os = tx.objectStore('records');
    toAdd.forEach((rec) => os.put(rec));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    records = await getAllRecords();
    if (!recordsInMonth(currentMonth).length) {
      const latest = records.reduce((a, b) => (a.date > b.date ? a : b));
      currentMonth = monthOf(latest.date);
    }
  }

  renderAll();
  renderCatManage();

  let msg = `导入完成：新增 ${toAdd.length} 笔`;
  if (duplicate) msg += `，${duplicate} 笔已存在`;
  if (invalid) msg += `，${invalid} 条无效已跳过`;
  toast(msg);
}

/* ============================================================
   AI 分析提示词
   ============================================================ */
function buildAnalysisPrompt() {
  const endKey = monthOf(todayStr());
  const startKey = addMonths(endKey, -2);
  const startDate = `${startKey}-01`;
  const endDate = todayStr();

  const list = records
    .filter((r) => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));

  if (!list.length) return null;

  const totalExp = sum(list.filter((r) => r.type === 'exp'));
  const totalInc = sum(list.filter((r) => r.type === 'inc'));

  const byCat = new Map();
  list.filter((r) => r.type === 'exp').forEach((r) => {
    byCat.set(r.category, (byCat.get(r.category) || 0) + r.amount);
  });
  const catLines = Array.from(byCat.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => `${name} ${fmtMoney(value)}（${totalExp ? Math.round((value / totalExp) * 100) : 0}%）`)
    .join('\n') || '（没有支出）';

  const detail = list.map((r) => {
    const tag = r.type === 'exp' ? '支出' : '收入';
    const note = r.note ? ` · ${r.note}` : '';
    return `${r.date} ${tag} ${r.category} ${fmtMoney(r.amount)}${note}`;
  }).join('\n');

  return `下面是我最近三个月的个人记账数据，帮我分析一下。

【时间范围】${startDate} 至 ${endDate}
【总支出】${fmtMoney(totalExp)}
【总收入】${fmtMoney(totalInc)}
【支出分类汇总】
${catLines}

【明细】
${detail}

【我想知道】
你帮我看看这三个月的钱都花到哪去了。哪些开销明显偏高、可以砍掉？有没有什么不太健康的消费习惯或者规律？再给我几条具体、能立刻照做的省钱建议。说人话，别整一堆术语，也别只是把上面的数字重复一遍。`;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续走兼容方案
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyPrompt() {
  const text = buildAnalysisPrompt();
  if (!text) {
    toast('最近三个月还没有账目');
    return;
  }
  const ok = await copyText(text);
  toast(ok ? '已复制，去 Claude App 里粘贴吧' : '复制失败，请再试一次');
}

/* ============================================================
   存储持久化 / Service Worker
   ============================================================ */
async function requestPersistence() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      await navigator.storage.persist();
    }
  } catch {
    // iOS 上可能不支持，忽略
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);

  // 不依赖 load 事件：init 是异步的，load 可能已经错过
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swReg = reg;
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' && hadController) {
          toast('已更新，重新打开即可使用新版本');
        }
      });
    });
  }).catch((e) => {
    console.warn('Service Worker 注册失败', e);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swReg) {
      swReg.update().catch(() => {});
    }
  });
}

/* ============================================================
   事件绑定
   ============================================================ */
function bindEvents() {
  $('#prev-month').addEventListener('click', () => {
    currentMonth = addMonths(currentMonth, -1);
    renderAll();
  });
  $('#next-month').addEventListener('click', () => {
    currentMonth = addMonths(currentMonth, 1);
    renderAll();
  });

  $('#add-btn').addEventListener('click', () => openEntry());
  $('#settings-btn').addEventListener('click', openSettings);

  // 趋势柱：点击切到对应月份
  $('#trend').addEventListener('click', (e) => {
    const col = e.target.closest('[data-month]');
    if (!col) return;
    currentMonth = col.dataset.month;
    renderAll();
  });

  // 记录项
  $('#record-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const rec = records.find((r) => r.id === row.dataset.id);
    if (rec) openEntry(rec);
  });

  // 记账弹窗
  $('#entry-cancel').addEventListener('click', () => closeSheet('#entry-backdrop'));
  $('#entry-save').addEventListener('click', saveEntry);
  $('#entry-delete').addEventListener('click', deleteEntry);

  $('#type-switch').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    entryType = btn.dataset.type;
    selectedCategory = categories[entryType][0] || null;
    $$('#type-switch button').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === entryType);
    });
    renderCategoryChips();
  });

  $('#category-chips').addEventListener('click', (e) => {
    if (e.target.closest('#chip-add')) {
      showChipAdd();
      return;
    }
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    selectedCategory = chip.dataset.cat;
    $$('#category-chips .chip[data-cat]').forEach((c) => {
      c.classList.toggle('active', c.dataset.cat === selectedCategory);
    });
  });

  $('#entry-amount').addEventListener('input', (e) => {
    let v = e.target.value.replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    const p = v.split('.');
    if (p.length === 2 && p[1].length > 2) v = p[0] + '.' + p[1].slice(0, 2);
    e.target.value = v;
  });
  $('#entry-amount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEntry();
    }
  });

  $('#entry-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSheet('#entry-backdrop');
  });

  // 设置
  $('#settings-close').addEventListener('click', () => closeSheet('#settings-backdrop'));
  $('#settings-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSheet('#settings-backdrop');
  });

  $('#export-json').addEventListener('click', exportJSON);
  $('#export-csv').addEventListener('click', exportCSV);

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) await importJSONFile(file);
  });

  $('#copy-prompt').addEventListener('click', copyPrompt);

  ['#cat-exp', '#cat-inc'].forEach((sel) => {
    $(sel).addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        removeCategory(del.dataset.type, del.dataset.del);
        return;
      }
      const add = e.target.closest('[data-add]');
      if (add) showCategoryAdd(add.dataset.add);
    });
  });

  $('#cat-add-confirm').addEventListener('click', confirmCategoryAdd);
  $('#cat-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmCategoryAdd();
    }
  });

  // 备份提醒
  $('#banner-backup').addEventListener('click', openSettings);
  $('#banner-dismiss').addEventListener('click', () => {
    bannerDismissed = true;
    renderBanner();
  });

  // Esc 关闭弹层（桌面）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#entry-backdrop').hidden) closeSheet('#entry-backdrop');
    else if (!$('#settings-backdrop').hidden) closeSheet('#settings-backdrop');
  });

  // 其他
  document.addEventListener('pointerdown', () => requestPersistence(), { once: true });
}

/* ============================================================
   启动
   ============================================================ */
async function init() {
  try {
    db = await openDB();
  } catch (e) {
    console.error(e);
    toast('本地存储不可用，请检查浏览器设置');
    return;
  }

  const savedCategories = await getMeta('categories', null);
  if (savedCategories && Array.isArray(savedCategories.exp) && Array.isArray(savedCategories.inc)) {
    categories = {
      exp: savedCategories.exp.slice(),
      inc: savedCategories.inc.slice(),
    };
  }

  lastBackupAt = Number(await getMeta('lastBackupAt', 0)) || 0;
  records = await getAllRecords();

  requestPersistence();
  bindEvents();
  renderAll();
  renderCatManage();
  renderStorageStatus();
  registerSW();
}

init();
