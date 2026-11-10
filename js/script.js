/* =========================================================
   Lilac Clock — script.js
   Vanilla JavaScript, tanpa library.

   Isi file:
   1. Helper & konfigurasi
   2. Waktu Jakarta (WIB)
   3. Suara (Web Audio API)
   4. Dialog & toast
   5. Clock
   6. Alarm
   7. Alarm / timer berbunyi (modal)
   8. Stopwatch
   9. Timer
   10. Navigasi & pengaturan
   11. Inisialisasi
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. Helper & konfigurasi
--------------------------------------------------------- */
const TIME_ZONE = 'Asia/Jakarta';
const STORAGE = {
  alarms: 'lilac-clock:alarms',
  snoozes: 'lilac-clock:snoozes',
  settings: 'lilac-clock:settings',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Ubah angka jadi 2 digit: 5 -> "05" */
function formatTime(n) {
  return String(n).padStart(2, '0');
}

/** Cegah teks dari user (nama alarm) dibaca sebagai HTML */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** localStorage bisa gagal (mode privat, penyimpanan penuh), jadi dibungkus try/catch */
function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* abaikan: aplikasi tetap berjalan tanpa penyimpanan */
  }
}

/** "05:30" -> 330 (menit sejak tengah malam) */
function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Ganti isi tombol (icon + teks) */
function setButton(button, iconId, text) {
  button.innerHTML = `<svg class="i" aria-hidden="true"><use href="#${iconId}"/></svg><span>${text}</span>`;
}

/** Buat susunan "00 : 00 : 00" di dalam sebuah elemen, lalu kembalikan elemen angkanya */
function makeDigits(container, groups) {
  container.textContent = '';
  const pairs = [];
  for (let i = 0; i < groups; i++) {
    const pair = document.createElement('span');
    pair.className = 'pair';
    pair.textContent = '00';
    container.appendChild(pair);
    pairs.push(pair);
    if (i < groups - 1) {
      const colon = document.createElement('span');
      colon.className = 'colon';
      colon.textContent = ':';
      container.appendChild(colon);
    }
  }
  return pairs;
}
function setDigits(pairs, values) {
  values.forEach((value, i) => {
    if (pairs[i].textContent !== value) pairs[i].textContent = value;
  });
}

/* ---------------------------------------------------------
   2. Waktu Jakarta (WIB, UTC+7)
   Kita tidak memakai jam perangkat mentah-mentah. Intl.DateTimeFormat
   dengan timeZone "Asia/Jakarta" memastikan waktunya selalu WIB,
   meskipun perangkat berada di zona waktu lain.
--------------------------------------------------------- */
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

let partsFormatter = null;
let dateFormatter = null;
try {
  partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  dateFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
} catch (error) {
  partsFormatter = null; // browser lama: pakai cara manual UTC+7 di bawah
}

/** Mengembalikan waktu Jakarta: jam, menit, detik, kunci tanggal, dan teks tanggal */
function getJakartaNow(date = new Date()) {
  if (partsFormatter && dateFormatter) {
    const p = {};
    partsFormatter.formatToParts(date).forEach((part) => { p[part.type] = part.value; });
    const hour = Number(p.hour) % 24;
    const minute = Number(p.minute);
    return {
      hour, minute, second: Number(p.second),
      minutesOfDay: hour * 60 + minute,
      dateKey: `${p.year}-${p.month}-${p.day}`,
      dateText: dateFormatter.format(date),
    };
  }
  // Cadangan: geser 7 jam dari UTC
  const j = new Date(date.getTime() + 7 * 3600 * 1000);
  const hour = j.getUTCHours();
  const minute = j.getUTCMinutes();
  return {
    hour, minute, second: j.getUTCSeconds(),
    minutesOfDay: hour * 60 + minute,
    dateKey: `${j.getUTCFullYear()}-${formatTime(j.getUTCMonth() + 1)}-${formatTime(j.getUTCDate())}`,
    dateText: `${DAY_NAMES[j.getUTCDay()]}, ${j.getUTCDate()} ${MONTH_NAMES[j.getUTCMonth()]} ${j.getUTCFullYear()}`,
  };
}

/** Sapaan sesuai jam */
function getGreeting(hour) {
  if (hour >= 4 && hour < 11) return 'Selamat pagi ✦';
  if (hour >= 11 && hour < 15) return 'Selamat siang ✦';
  if (hour >= 15 && hour < 18) return 'Selamat sore ✦';
  return 'Selamat malam ✦';
}

/** 95 menit -> "1 jam 35 menit" (detik dipakai agar hitungan lebih akurat) */
function formatEta(minutes, seconds = 0) {
  const total = minutes * 60 - seconds;
  if (total < 60) return 'kurang dari 1 menit lagi';
  const m = Math.floor(total / 60);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [];
  if (h) parts.push(`${h} jam`);
  if (rest) parts.push(`${rest} menit`);
  return `${parts.join(' ')} lagi`;
}

/* ---------------------------------------------------------
   3. Suara (Web Audio API)
   Semua bunyi dibuat langsung oleh browser, jadi tidak perlu file
   audio dan tidak ada masalah hak cipta.
--------------------------------------------------------- */
let settings = { sound: 'bell', volume: 70 };
let audioCtx = null;
let masterGain = null;   // pengatur volume utama
let soundBus = null;     // "jalur" untuk satu sesi bunyi, bisa diputus saat dimatikan
let soundLoop = null;
let soundLimit = null;
let activeCycle = null;

/** Buat satu nada */
function tone(freq, type, start, duration, volume, attack = 0.008) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(soundBus || masterGain);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Satu pukulan lonceng = beberapa nada (partial) yang meredup */
function bellStrike(t, base) {
  [[1, 0.32, 2.4], [2.01, 0.14, 1.6], [3.02, 0.07, 1.1], [4.2, 0.035, 0.7]].forEach(([ratio, vol, dur]) => {
    tone(base * ratio, 'sine', t, dur, vol);
  });
}

const SOUND_PRESETS = {
  bell: {
    label: 'Soft Bell', cycle: 3.4,
    play(t) { bellStrike(t, 880); bellStrike(t + 1.3, 1046.5); },
  },
  digital: {
    label: 'Digital', cycle: 1.6,
    play(t) { [0, 0.2, 0.4, 0.6].forEach((o) => tone(1568, 'square', t + o, 0.11, 0.09, 0.004)); },
  },
  cute: {
    label: 'Cute', cycle: 1.9,
    play(t) {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 'triangle', t + i * 0.14, 0.3, 0.22));
      [1568, 1175, 988, 1319].forEach((f, i) => tone(f, 'triangle', t + 0.85 + i * 0.14, 0.3, 0.18));
      tone(2093, 'sine', t + 0.56, 0.35, 0.08);
    },
  },
  classic: {
    label: 'Classic', cycle: 1.8,
    play(t) { for (let i = 0; i < 16; i++) tone(i % 2 ? 1000 : 1250, 'triangle', t + i * 0.055, 0.045, 0.2, 0.004); },
  },
};

/** Buat AudioContext (harus setelah user berinteraksi agar tidak diblokir browser) */
function ensureAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    audioCtx.onstatechange = onAudioStateChange;
  }
  masterGain.gain.value = settings.volume / 100;
  return audioCtx;
}

/** Dipanggil saat user pertama kali berinteraksi, agar browser mengizinkan suara */
function unlockAudio() {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state !== 'running') {
    ctx.resume().then(onAudioStateChange).catch(() => {});
  } else {
    onAudioStateChange();
  }
}

function onAudioStateChange() {
  const running = !!audioCtx && audioCtx.state === 'running';
  $('#audio-chip').hidden = running;
  if (running && activeCycle) activeCycle(); // alarm sedang berbunyi tapi tadi diblokir
  refreshRingHint();
}

/**
 * Mainkan suara alarm.
 * loop = true  -> berulang sampai dimatikan (maks. 2 menit)
 * loop = false -> sekali saja (untuk pratinjau)
 */
function playAlarmSound(loop = true, key = settings.sound) {
  stopAlarmSound();
  const ctx = ensureAudio();
  if (!ctx) return;
  const preset = SOUND_PRESETS[key] || SOUND_PRESETS.bell;

  soundBus = ctx.createGain();
  soundBus.connect(masterGain);

  const playCycle = () => {
    if (ctx.state !== 'running') {
      // Mungkin masih diblokir sampai user menyentuh layar. Untuk pratinjau, mainkan setelah resume berhasil.
      ctx.resume().then(() => {
        if (!loop && ctx.state === 'running') preset.play(ctx.currentTime + 0.05);
      }).catch(() => {});
      return;
    }
    preset.play(ctx.currentTime + 0.05);
  };
  playCycle();

  if (loop) {
    activeCycle = playCycle;
    soundLoop = setInterval(playCycle, preset.cycle * 1000);
    soundLimit = setTimeout(stopAlarmSound, 120000);
  }
}

function stopAlarmSound() {
  clearInterval(soundLoop);
  clearTimeout(soundLimit);
  soundLoop = soundLimit = activeCycle = null;
  if (soundBus && audioCtx) {
    const old = soundBus;
    old.gain.cancelScheduledValues(audioCtx.currentTime);
    old.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03); // fade out cepat, tanpa "klik"
    setTimeout(() => { try { old.disconnect(); } catch (e) { /* sudah terputus */ } }, 300);
  }
  soundBus = null;
}

/* ---------------------------------------------------------
   4. Dialog & toast
--------------------------------------------------------- */
function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}
function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

let toastTimer = null;
function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------------------------------------------------------
   5. Clock
--------------------------------------------------------- */
let clockDigits = [];
let lastSecond = -1;
let lastMinute = -1;
let lastHour = -1;

/** Dipanggil terus-menerus; hanya menyentuh layar kalau detiknya berubah */
function updateClock() {
  const now = getJakartaNow();
  if (now.second === lastSecond) return now;
  lastSecond = now.second;

  setDigits(clockDigits, [formatTime(now.hour), formatTime(now.minute), formatTime(now.second)]);
  $('#clock-date').textContent = now.dateText;

  // Bar detik di bawah jam; saat detik 0 bar kembali tanpa animasi mundur
  const fill = $('#sec-fill');
  fill.classList.toggle('no-anim', now.second === 0);
  fill.style.transform = `scaleX(${(now.second + 1) / 60})`;

  if (now.hour !== lastHour) {
    lastHour = now.hour;
    updateGreeting(now.hour);
  }
  if (now.minute !== lastMinute) {
    lastMinute = now.minute;
    // Screen reader cukup dibacakan per menit, bukan tiap detik
    $('#clock-face').setAttribute('aria-label',
      `${formatTime(now.hour)}:${formatTime(now.minute)} WIB, ${now.dateText}`);
  }
  renderNextAlarm(now);
  return now;
}

function updateGreeting(hour) {
  $('#greeting').textContent = getGreeting(hour);
}

/* ---------------------------------------------------------
   6. Alarm
   Setiap alarm: { id, time:"HH:MM", label, enabled, repeat, lastFired }
   lastFired = "tanggal|jam" saat terakhir berbunyi. Ini mencegah alarm
   berbunyi berulang kali di menit yang sama (atau setelah refresh).
--------------------------------------------------------- */
let alarms = [];
let snoozes = []; // { id, label, time, at(ms) }
let editingId = null;

function saveAlarms() { writeStorage(STORAGE.alarms, alarms); }
function saveSnoozes() { writeStorage(STORAGE.snoozes, snoozes); }

function loadAlarms() {
  const data = readStorage(STORAGE.alarms, []);
  alarms = Array.isArray(data)
    ? data.filter((a) => a && typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time))
        .map((a) => ({
          id: a.id || uid(),
          time: a.time,
          label: String(a.label || 'Alarm').slice(0, 30),
          enabled: !!a.enabled,
          repeat: !!a.repeat,
          lastFired: a.lastFired || null,
        }))
    : [];
  const snoozeData = readStorage(STORAGE.snoozes, []);
  snoozes = Array.isArray(snoozeData) ? snoozeData.filter((s) => s && typeof s.at === 'number') : [];
}

/** Jika jam alarm sudah lewat hari ini, tandai "sudah berbunyi" agar baru berbunyi besok */
function markPassedToday(alarm) {
  const now = getJakartaNow();
  alarm.lastFired = toMinutes(alarm.time) < now.minutesOfDay ? `${now.dateKey}|${alarm.time}` : null;
}

function addAlarm(time, label, repeat) {
  const alarm = { id: uid(), time, label: label || 'Alarm', enabled: true, repeat: !!repeat, lastFired: null };
  markPassedToday(alarm);
  alarms.push(alarm);
  saveAlarms();
  renderAlarms();
  return alarm;
}

function updateAlarm(id, time, label, repeat) {
  const alarm = alarms.find((a) => a.id === id);
  if (!alarm) return null;
  alarm.time = time;
  alarm.label = label || 'Alarm';
  alarm.repeat = !!repeat;
  alarm.enabled = true;
  markPassedToday(alarm);
  snoozes = snoozes.filter((s) => s.id !== id);
  saveAlarms();
  saveSnoozes();
  renderAlarms();
  return alarm;
}

function toggleAlarm(id, enabled) {
  const alarm = alarms.find((a) => a.id === id);
  if (!alarm) return;
  alarm.enabled = enabled;
  if (enabled) markPassedToday(alarm);
  else snoozes = snoozes.filter((s) => s.id !== id); // alarm dimatikan = snooze ikut batal
  saveAlarms();
  saveSnoozes();
  renderAlarms();
}

function deleteAlarm(id) {
  alarms = alarms.filter((a) => a.id !== id);
  snoozes = snoozes.filter((s) => s.id !== id);
  saveAlarms();
  saveSnoozes();
  renderAlarms();
  showToast('Alarm dihapus');
}

/** Gambar ulang daftar alarm */
function renderAlarms() {
  const list = $('#alarm-list');
  // Jaga fokus keyboard pada toggle yang baru ditekan
  const focusedToggle = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.toggle : null;

  list.textContent = '';
  const sorted = [...alarms].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

  sorted.forEach((alarm) => {
    const snooze = snoozes.find((s) => s.id === alarm.id);
    let snoozeTag = '';
    if (snooze) {
      const t = getJakartaNow(new Date(snooze.at));
      snoozeTag = `<span class="tag tag-blue">Snooze ${formatTime(t.hour)}:${formatTime(t.minute)}</span>`;
    }
    const name = escapeHtml(alarm.label);
    const li = document.createElement('li');
    li.className = 'alarm-card' + (alarm.enabled ? ' is-on' : '');
    li.innerHTML = `
      <div class="alarm-info">
        <p class="alarm-time">${alarm.time}</p>
        <p class="alarm-meta">
          <span class="alarm-label">${name}</span>
          <span class="tag">${alarm.repeat ? 'Harian' : 'Sekali'}</span>
          ${snoozeTag}
        </p>
      </div>
      <div class="alarm-actions">
        <button class="icon-btn small" type="button" data-action="edit" data-id="${alarm.id}" aria-label="Ubah alarm ${alarm.time} ${name}">
          <svg class="i" aria-hidden="true"><use href="#i-pencil"/></svg>
        </button>
        <button class="icon-btn small" type="button" data-action="delete" data-id="${alarm.id}" aria-label="Hapus alarm ${alarm.time} ${name}">
          <svg class="i" aria-hidden="true"><use href="#i-trash"/></svg>
        </button>
        <span class="switch">
          <input type="checkbox" role="switch" data-toggle="${alarm.id}" ${alarm.enabled ? 'checked' : ''} aria-label="Alarm ${alarm.time} ${name}">
          <span class="switch-track" aria-hidden="true"></span>
        </span>
      </div>`;
    list.appendChild(li);
  });

  $('#alarm-empty').hidden = alarms.length > 0;
  list.hidden = alarms.length === 0;

  if (focusedToggle) {
    const again = list.querySelector(`input[data-toggle="${focusedToggle}"]`);
    if (again) again.focus();
  }
  renderNextAlarm();
}

/** Cari alarm aktif yang paling dekat dari sekarang */
function getNextAlarm(now) {
  let best = null;
  alarms.forEach((alarm) => {
    if (!alarm.enabled) return;
    let delta = (toMinutes(alarm.time) - now.minutesOfDay + 1440) % 1440;
    if (delta === 0 && alarm.lastFired === `${now.dateKey}|${alarm.time}`) delta = 1440; // sudah berbunyi hari ini
    if (!best || delta < best.delta) best = { alarm, delta };
  });
  return best;
}

/** Kartu "Alarm berikutnya" di halaman Clock */
function renderNextAlarm(now = getJakartaNow()) {
  const next = getNextAlarm(now);
  const card = $('#next-alarm');
  const badge = $('#next-badge');
  if (next) {
    $('#next-time').textContent = next.alarm.time;
    $('#next-meta').textContent = `${next.alarm.label} · ${formatEta(next.delta, now.second)}`;
    badge.textContent = 'ON';
    badge.classList.add('on');
    card.classList.add('is-on');
    card.setAttribute('aria-label', `Alarm berikutnya ${next.alarm.time}, ${next.alarm.label}. Buka daftar alarm`);
  } else {
    $('#next-time').textContent = '--:--';
    $('#next-meta').textContent = 'Belum ada alarm aktif';
    badge.textContent = 'OFF';
    badge.classList.remove('on');
    card.classList.remove('is-on');
    card.setAttribute('aria-label', 'Belum ada alarm aktif. Buka daftar alarm');
  }
}

/**
 * Dipanggil terus-menerus. Alarm berbunyi jika:
 * - alarm aktif,
 * - waktu sekarang (WIB) sudah mencapai jam alarm (toleransi 1 menit
 *   supaya tidak terlewat bila tab sempat "tidur"),
 * - dan belum pernah berbunyi untuk tanggal + jam ini (lastFired).
 */
function checkAlarms(now = getJakartaNow()) {
  let changed = false;

  alarms.forEach((alarm) => {
    if (!alarm.enabled) return;
    const diff = now.minutesOfDay - toMinutes(alarm.time);
    const key = `${now.dateKey}|${alarm.time}`;
    if (diff >= 0 && diff <= 1 && alarm.lastFired !== key) {
      alarm.lastFired = key;               // kunci: hanya sekali
      if (!alarm.repeat) alarm.enabled = false; // alarm "sekali" otomatis mati
      changed = true;
      triggerAlarm({ id: alarm.id, label: alarm.label, time: alarm.time });
    }
  });

  // Snooze yang waktunya sudah tiba
  const nowMs = Date.now();
  const due = snoozes.filter((s) => nowMs >= s.at);
  if (due.length) {
    snoozes = snoozes.filter((s) => nowMs < s.at);
    saveSnoozes();
    due.forEach((s) => triggerAlarm({ id: s.id, label: s.label, time: s.time }));
    changed = true;
  }

  if (changed) {
    saveAlarms();
    renderAlarms();
  }
}

/* --- Dialog tambah / ubah alarm --- */
function populateTimeSelects() {
  const hour = $('#alarm-hour');
  const minute = $('#alarm-minute');
  for (let h = 0; h < 24; h++) hour.add(new Option(formatTime(h), formatTime(h)));
  for (let m = 0; m < 60; m++) minute.add(new Option(formatTime(m), formatTime(m)));
}

function openAlarmDialog(alarm = null) {
  editingId = alarm ? alarm.id : null;
  $('#alarm-dialog-title').textContent = alarm ? 'Ubah Alarm' : 'Tambah Alarm';

  if (alarm) {
    const [h, m] = alarm.time.split(':');
    $('#alarm-hour').value = h;
    $('#alarm-minute').value = m;
    $('#alarm-label').value = alarm.label;
    $('#alarm-repeat').checked = alarm.repeat;
  } else {
    const now = getJakartaNow();
    $('#alarm-hour').value = formatTime((now.hour + 1) % 24); // default: jam berikutnya
    $('#alarm-minute').value = '00';
    $('#alarm-label').value = '';
    $('#alarm-repeat').checked = false;
  }
  openDialog($('#alarm-dialog'));
  $('#alarm-hour').focus();
}

function handleAlarmSubmit(event) {
  event.preventDefault();
  const time = `${$('#alarm-hour').value}:${$('#alarm-minute').value}`;
  const label = $('#alarm-label').value.trim();
  const repeat = $('#alarm-repeat').checked;

  if (editingId) updateAlarm(editingId, time, label, repeat);
  else addAlarm(time, label, repeat);

  closeDialog($('#alarm-dialog'));
  const now = getJakartaNow();
  const delta = (toMinutes(time) - now.minutesOfDay + 1440) % 1440;
  showToast(`Alarm ${time} aktif · ${formatEta(delta, now.second)}`);
}

/* ---------------------------------------------------------
   7. Alarm / timer berbunyi (modal)
--------------------------------------------------------- */
let activeRing = null;
const ringQueue = [];
const originalTitle = document.title;

/** Alarm berbunyi: masuk antrean bila ada alarm lain yang sedang berbunyi */
function triggerAlarm(info) {
  triggerRing({ kind: 'alarm', ...info });
}

function triggerRing(info) {
  if (activeRing) {
    ringQueue.push(info);
    return;
  }
  showRing(info);
}

function showRing(info) {
  activeRing = info;
  const now = getJakartaNow();
  $('#ring-greeting').textContent = info.kind === 'timer' ? 'Waktu habis ✦' : getGreeting(now.hour);

  if (info.kind === 'timer') {
    $('#ring-title').textContent = 'Timer selesai';
    $('#ring-time').textContent = info.display;
    $('#ring-text').textContent = 'Hitung mundur sudah mencapai nol.';
    $('#ring-stop').textContent = 'Stop';
    $('#snooze-row').hidden = true;
  } else {
    $('#ring-title').textContent = info.label;
    $('#ring-time').textContent = info.time;
    $('#ring-text').textContent = 'Saatnya! Alarm kamu berbunyi.';
    $('#ring-stop').textContent = 'Matikan';
    $('#snooze-row').hidden = false;
  }

  document.body.classList.add('ringing');
  document.title = `🔔 ${info.kind === 'timer' ? 'Timer selesai' : info.label}`;
  openDialog($('#ring-dialog'));
  $('#ring-stop').focus();

  playAlarmSound(true);
  setTimeout(refreshRingHint, 400);
}

/** Tampilkan petunjuk jika browser memblokir suara */
function refreshRingHint() {
  const blocked = !!activeRing && (!audioCtx || audioCtx.state !== 'running');
  $('#ring-hint').hidden = !blocked;
}

function closeRing() {
  closeDialog($('#ring-dialog'));
  stopAlarmSound();
  document.body.classList.remove('ringing');
  document.title = originalTitle;
  activeRing = null;
  $('#ring-hint').hidden = true;
  if (ringQueue.length) {
    setTimeout(() => {
      const next = ringQueue.shift();
      if (!next) return;
      if (activeRing) ringQueue.unshift(next); // sudah ada yang berbunyi, tunggu giliran
      else showRing(next);
    }, 350);
  }
}

/** Tombol "Matikan" / "Stop" */
function stopAlarm() {
  if (!activeRing) return;
  const wasTimer = activeRing.kind === 'timer';
  closeRing();
  if (wasTimer && timer.status === 'finished') resetTimer();
}

/** Tombol "Snooze": alarm berbunyi lagi beberapa menit kemudian */
function snoozeAlarm(minutes) {
  if (!activeRing || activeRing.kind !== 'alarm') return;
  const { id, label, time } = activeRing;
  snoozes = snoozes.filter((s) => s.id !== id);
  snoozes.push({ id, label, time, at: Date.now() + minutes * 60000 });
  saveSnoozes();
  closeRing();
  renderAlarms();
  showToast(`Snooze ${minutes} menit ✦`);
}

/* ---------------------------------------------------------
   8. Stopwatch
   Memakai performance.now() sehingga tetap akurat walaupun
   interval browser sedikit telat.
--------------------------------------------------------- */
const stopwatch = { running: false, elapsed: 0, startedAt: 0, handle: null, laps: [] };
let swDigits = [];

function stopwatchValue() {
  return stopwatch.running ? stopwatch.elapsed + (performance.now() - stopwatch.startedAt) : stopwatch.elapsed;
}

/** ms -> ["HH","MM","SS","MS"] (MS = per seperseratus detik) */
function splitStopwatch(ms) {
  const total = Math.floor(ms);
  return [
    Math.floor(total / 3600000),
    Math.floor(total / 60000) % 60,
    Math.floor(total / 1000) % 60,
    Math.floor((total % 1000) / 10),
  ].map(formatTime);
}

function renderStopwatch() {
  setDigits(swDigits, splitStopwatch(stopwatchValue()));
}

function updateStopwatchUI() {
  const toggle = $('#sw-toggle');
  const status = $('#sw-status');
  const text = $('#sw-status-text');
  const started = stopwatch.elapsed > 0 || stopwatch.running;

  if (stopwatch.running) setButton(toggle, 'i-pause', 'Pause');
  else setButton(toggle, 'i-play', started ? 'Lanjut' : 'Start');

  $('#sw-lap').disabled = !stopwatch.running;
  $('#sw-reset').disabled = !started;
  $('#sw-time').classList.toggle('is-running', stopwatch.running);

  status.classList.toggle('is-running', stopwatch.running);
  text.textContent = stopwatch.running ? '● Running' : (started ? 'Dijeda' : 'Siap');
}

function startStopwatch() {
  if (stopwatch.running) return;
  stopwatch.running = true;
  stopwatch.startedAt = performance.now();
  stopwatch.handle = setInterval(renderStopwatch, 33);
  updateStopwatchUI();
}

function pauseStopwatch() {
  if (!stopwatch.running) return;
  stopwatch.elapsed = stopwatchValue();
  stopwatch.running = false;
  clearInterval(stopwatch.handle);
  renderStopwatch();
  updateStopwatchUI();
}

function resetStopwatch() {
  clearInterval(stopwatch.handle);
  stopwatch.running = false;
  stopwatch.elapsed = 0;
  stopwatch.laps = [];
  renderStopwatch();
  renderLaps();
  updateStopwatchUI();
}

function addLap() {
  if (!stopwatch.running) return;
  const total = stopwatchValue();
  const previous = stopwatch.laps.length ? stopwatch.laps[0].total : 0;
  stopwatch.laps.unshift({ n: stopwatch.laps.length + 1, total, split: total - previous });
  renderLaps();
}

function formatStopwatch(ms) {
  const [h, m, s, c] = splitStopwatch(ms);
  return h === '00' ? `${m}:${s}.${c}` : `${h}:${m}:${s}.${c}`;
}

function renderLaps() {
  const list = $('#lap-list');
  const laps = stopwatch.laps;
  list.textContent = '';
  $('#lap-empty').hidden = laps.length > 0;

  // Tandai lap tercepat & terlambat (butuh minimal 3 lap)
  let best = null;
  let worst = null;
  if (laps.length >= 3) {
    best = Math.min(...laps.map((l) => l.split));
    worst = Math.max(...laps.map((l) => l.split));
  }

  laps.forEach((lap) => {
    const li = document.createElement('li');
    li.className = 'lap' + (lap.split === best ? ' is-best' : '') + (lap.split === worst ? ' is-worst' : '');
    li.innerHTML = `<span class="lap-n">Lap ${lap.n}</span><span class="lap-split">${formatStopwatch(lap.split)}</span><span class="lap-total">${formatStopwatch(lap.total)}</span>`;
    list.appendChild(li);
  });
}

/* ---------------------------------------------------------
   9. Timer
   Memakai waktu akhir (endAt) dari Date.now(), bukan menghitung
   mundur per tick, sehingga tetap akurat walau tab sempat melambat.
--------------------------------------------------------- */
const timer = { status: 'idle', total: 0, remaining: 0, endAt: 0, handle: null };
const RING_LENGTH = 2 * Math.PI * 46; // keliling lingkaran progress (r = 46)
let timerDigits = [];

function readTimerInputs() {
  const h = clamp(parseInt($('#timer-h').value, 10) || 0, 0, 99);
  const m = clamp(parseInt($('#timer-m').value, 10) || 0, 0, 59);
  const s = clamp(parseInt($('#timer-s').value, 10) || 0, 0, 59);
  return (h * 3600 + m * 60 + s) * 1000;
}

function setTimerInputs(totalSeconds) {
  $('#timer-h').value = Math.floor(totalSeconds / 3600);
  $('#timer-m').value = Math.floor(totalSeconds / 60) % 60;
  $('#timer-s').value = totalSeconds % 60;
  renderTimer();
}

function renderTimer() {
  const ms = timer.status === 'idle' ? readTimerInputs() : timer.remaining;
  const cs = Math.ceil(ms / 10); // dibulatkan ke atas agar "00:00:00:00" hanya muncul saat benar-benar habis
  setDigits(timerDigits, [
    formatTime(Math.floor(cs / 360000)),
    formatTime(Math.floor(cs / 6000) % 60),
    formatTime(Math.floor(cs / 100) % 60),
    formatTime(cs % 100),
  ]);

  // Lingkaran progress
  const ratio = timer.status === 'idle' || timer.total === 0 ? 1 : timer.remaining / timer.total;
  $('#timer-progress').style.strokeDashoffset = String(RING_LENGTH * (1 - ratio));

  const ring = $('#timer-ring');
  ring.classList.toggle('is-urgent', timer.status === 'running' && timer.remaining <= 10000 && timer.remaining > 0);

  // Tandai preset yang sesuai
  if (timer.status === 'idle') {
    $$('.presets .preset').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.seconds) * 1000 === ms);
    });
  }
}

function updateTimerUI() {
  const toggle = $('#timer-toggle');
  const reset = $('#timer-reset');
  const status = $('#timer-status');
  const text = $('#timer-status-text');
  const ring = $('#timer-ring');

  ring.classList.toggle('is-running', timer.status === 'running');
  ring.classList.toggle('is-done', timer.status === 'finished');
  status.classList.toggle('is-running', timer.status === 'running');
  status.classList.toggle('is-done', timer.status === 'finished');
  $('#timer-setup').hidden = timer.status !== 'idle';
  $('#timer-done-text').hidden = timer.status !== 'finished';
  reset.disabled = timer.status === 'idle' || timer.status === 'finished';

  switch (timer.status) {
    case 'running':
      setButton(toggle, 'i-pause', 'Pause');
      text.textContent = '● Berjalan';
      break;
    case 'paused':
      setButton(toggle, 'i-play', 'Resume');
      text.textContent = 'Dijeda';
      break;
    case 'finished':
      setButton(toggle, 'i-x', 'Stop');
      text.textContent = 'Selesai ✦';
      break;
    default:
      setButton(toggle, 'i-play', 'Start');
      text.textContent = 'Siap';
  }
}

function startTimer() {
  if (timer.status === 'paused') { resumeTimer(); return; }
  if (timer.status !== 'idle') return;

  const total = readTimerInputs();
  if (total <= 0) {
    showToast('Atur durasi timer dulu ✦');
    const box = $('.time-inputs');
    box.classList.remove('shake');
    void box.offsetWidth; // memulai ulang animasi
    box.classList.add('shake');
    return;
  }
  unlockAudio(); // tombol Start = interaksi user, jadi suara akhir timer pasti diizinkan
  timer.total = total;
  timer.remaining = total;
  timer.endAt = Date.now() + total;
  runTimer();
}

function runTimer() {
  timer.status = 'running';
  clearInterval(timer.handle);
  timer.handle = setInterval(tickTimer, 50);
  updateTimerUI();
  tickTimer();
}

function pauseTimer() {
  if (timer.status !== 'running') return;
  timer.remaining = Math.max(0, timer.endAt - Date.now());
  clearInterval(timer.handle);
  timer.status = 'paused';
  updateTimerUI();
  renderTimer();
}

function resumeTimer() {
  if (timer.status !== 'paused') return;
  timer.endAt = Date.now() + timer.remaining;
  runTimer();
}

function tickTimer() {
  timer.remaining = Math.max(0, timer.endAt - Date.now());
  renderTimer();
  if (timer.remaining <= 0) finishTimer();
}

function finishTimer() {
  clearInterval(timer.handle);
  timer.status = 'finished';
  timer.remaining = 0;
  renderTimer();
  updateTimerUI();
  const s = Math.round(timer.total / 1000);
  triggerRing({
    kind: 'timer',
    display: `${formatTime(Math.floor(s / 3600))}:${formatTime(Math.floor(s / 60) % 60)}:${formatTime(s % 60)}`,
  });
}

function resetTimer() {
  clearInterval(timer.handle);
  const wasFinished = timer.status === 'finished';
  timer.status = 'idle';
  timer.total = 0;
  timer.remaining = 0;

  // Jika dihentikan dari halaman Timer, tutup juga modal & suaranya
  if (wasFinished) {
    for (let i = ringQueue.length - 1; i >= 0; i--) {
      if (ringQueue[i].kind === 'timer') ringQueue.splice(i, 1);
    }
    if (activeRing && activeRing.kind === 'timer') closeRing();
  }
  updateTimerUI();
  renderTimer();
}

/* ---------------------------------------------------------
   10. Navigasi & pengaturan
--------------------------------------------------------- */
function switchView(name) {
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${name}`; });
  $$('.nav-btn').forEach((btn) => {
    const active = btn.dataset.view === name;
    btn.classList.toggle('is-active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadSettings() {
  const saved = readStorage(STORAGE.settings, {});
  if (saved && SOUND_PRESETS[saved.sound]) settings.sound = saved.sound;
  if (saved && typeof saved.volume === 'number') settings.volume = clamp(saved.volume, 0, 100);
}
function saveSettings() { writeStorage(STORAGE.settings, settings); }

function syncSettingsUI() {
  $$('input[name="sound"]').forEach((radio) => { radio.checked = radio.value === settings.sound; });
  $('#volume').value = settings.volume;
  $('#volume-val').textContent = `${settings.volume}%`;
}

/* ---------------------------------------------------------
   11. Inisialisasi & event
--------------------------------------------------------- */
function bindEvents() {
  // Izin audio: interaksi pertama dari user membuka kunci suara
  ['pointerdown', 'keydown'].forEach((type) => {
    document.addEventListener(type, unlockAudio, { once: true });
  });
  $('#audio-chip').addEventListener('click', () => {
    unlockAudio();
    playAlarmSound(false);
  });

  // Navigasi
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#next-alarm').addEventListener('click', () => switchView('alarm'));

  // Alarm
  $('#add-alarm-btn').addEventListener('click', () => openAlarmDialog());
  $('#add-alarm-empty').addEventListener('click', () => openAlarmDialog());
  $('#alarm-form').addEventListener('submit', handleAlarmSubmit);
  $('#alarm-close').addEventListener('click', () => closeDialog($('#alarm-dialog')));
  $('#alarm-cancel').addEventListener('click', () => closeDialog($('#alarm-dialog')));
  $$('.label-chips .preset').forEach((chip) => {
    chip.addEventListener('click', () => { $('#alarm-label').value = chip.dataset.label; });
  });

  const alarmList = $('#alarm-list');
  alarmList.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-toggle]');
    if (input) toggleAlarm(input.dataset.toggle, input.checked);
  });
  alarmList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'edit') openAlarmDialog(alarms.find((a) => a.id === button.dataset.id));
    if (button.dataset.action === 'delete') deleteAlarm(button.dataset.id);
  });

  // Klik area gelap di luar kartu = tutup dialog (kecuali dialog alarm berbunyi)
  ['#alarm-dialog', '#settings-dialog'].forEach((selector) => {
    const dialog = $(selector);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(dialog); });
  });

  // Modal alarm berbunyi harus dimatikan lewat tombol (Esc diabaikan)
  $('#ring-dialog').addEventListener('cancel', (event) => event.preventDefault());
  $('#ring-stop').addEventListener('click', stopAlarm);
  $('#ring-snooze-5').addEventListener('click', () => snoozeAlarm(5));
  $('#ring-snooze-10').addEventListener('click', () => snoozeAlarm(10));

  // Stopwatch
  $('#sw-toggle').addEventListener('click', () => (stopwatch.running ? pauseStopwatch() : startStopwatch()));
  $('#sw-lap').addEventListener('click', addLap);
  $('#sw-reset').addEventListener('click', resetStopwatch);

  // Timer
  $('#timer-toggle').addEventListener('click', () => {
    if (timer.status === 'idle') startTimer();
    else if (timer.status === 'running') pauseTimer();
    else if (timer.status === 'paused') resumeTimer();
    else if (timer.status === 'finished') resetTimer(); // sekaligus menutup modal & suara
  });
  $('#timer-reset').addEventListener('click', resetTimer);
  ['#timer-h', '#timer-m', '#timer-s'].forEach((selector) => {
    $(selector).addEventListener('input', renderTimer);
    $(selector).addEventListener('blur', (event) => {
      // Rapikan nilai yang kosong / di luar batas
      const max = Number(event.target.max);
      event.target.value = clamp(parseInt(event.target.value, 10) || 0, 0, max);
      renderTimer();
    });
  });
  $$('.presets .preset').forEach((btn) => {
    btn.addEventListener('click', () => setTimerInputs(Number(btn.dataset.seconds)));
  });

  // Pengaturan suara
  $('#open-settings').addEventListener('click', () => { syncSettingsUI(); openDialog($('#settings-dialog')); });
  $('#settings-close').addEventListener('click', () => closeDialog($('#settings-dialog')));
  $('#settings-done').addEventListener('click', () => closeDialog($('#settings-dialog')));
  $('#test-sound').addEventListener('click', () => { unlockAudio(); playAlarmSound(false); });
  $$('input[name="sound"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      settings.sound = radio.value;
      saveSettings();
      unlockAudio();
      playAlarmSound(false); // pratinjau nada yang dipilih
    });
  });
  const volume = $('#volume');
  volume.addEventListener('input', () => {
    settings.volume = Number(volume.value);
    $('#volume-val').textContent = `${settings.volume}%`;
    if (masterGain) masterGain.gain.value = settings.volume / 100;
    saveSettings();
  });
  volume.addEventListener('change', () => { unlockAudio(); playAlarmSound(false); });

  // Saat tab kembali terlihat, langsung sinkronkan jam & cek alarm
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}

/** Satu "detak": perbarui jam lalu cek alarm */
function tick() {
  const now = updateClock();
  checkAlarms(now);
}

function init() {
  loadSettings();
  loadAlarms();

  clockDigits = makeDigits($('#clock-time'), 3);
  swDigits = makeDigits($('#sw-time'), 4);
  timerDigits = makeDigits($('#timer-time'), 4);

  populateTimeSelects();
  bindEvents();
  syncSettingsUI();

  renderAlarms();
  renderStopwatch();
  renderLaps();
  updateStopwatchUI();
  renderTimer();
  updateTimerUI();

  $('#audio-chip').hidden = false; // sampai user berinteraksi, suara belum diizinkan
  tick();
  setInterval(tick, 250);          // dicek 4x per detik agar pergantian detik terasa tepat
}

init();
