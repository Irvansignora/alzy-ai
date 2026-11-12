/**
 * daftar-job.iranza.com — Form pendaftaran job (TG / Gijinkoku)
 *
 * Routes:
 *   GET  /              -> halaman form
 *   GET  /api/jobs      -> daftar lowongan (dibaca dari Google Sheet "Daftar Lowongan")
 *   POST /api/submit    -> simpan pendaftar ke D1 (+ opsional langsung ke Google Sheets)
 *   GET  /export.csv?key=EXPORT_KEY -> semua pendaftar sbg CSV (dipakai IMPORTDATA di spreadsheet)
 *
 * Bindings / vars:
 *   DB              D1 database (tabel `pendaftar`, lihat schema.sql)
 *   JOBS_SHEET_ID   ID Google Sheet lowongan (share: "Siapa saja yang memiliki link - Viewer")
 *   EXPORT_KEY      (secret) kunci untuk /export.csv
 * Opsional (kalau diisi, tiap pendaftar juga langsung di-append ke Sheets via service account):
 *   SHEET_ID, SHEET_TAB, GOOGLE_SA_EMAIL (secret), GOOGLE_SA_KEY (secret)
 */
import FORM_HTML from './form.html';

const LEVELS = [
  'Belum pernah belajar',
  'Pemula (belum bersertifikat)',
  'JLPT N5', 'JLPT N4', 'JLPT N3', 'JLPT N2', 'JLPT N1',
  'JFT-Basic A2'
];
const KATEGORI = ['TG', 'Gijinkoku'];
const JOBS_TTL = 60; // detik — perubahan di sheet lowongan muncul di form maks ±1 menit

let cachedToken = null; // { token, exp }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return new Response(FORM_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        }
      });
    }
    if (method === 'GET' && url.pathname === '/api/jobs') {
      try {
        const jobs = await getJobs(env, ctx);
        return json({ ok: true, jobs }, 200, { 'Cache-Control': `public, max-age=${JOBS_TTL}` });
      } catch (e) {
        console.error('Jobs error', e);
        return json({ ok: false, jobs: [], error: 'Daftar lowongan belum bisa dimuat.' }, 502);
      }
    }
    if (method === 'POST' && url.pathname === '/api/submit') return handleSubmit(request, env, ctx);
    if (method === 'GET' && url.pathname === '/export.csv') return handleExport(url, env);

    return new Response('Not found', { status: 404 });
  }
};

/* ---------- Lowongan (dari Google Sheet) ---------- */

async function getJobs(env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://jobs-cache.internal/${env.JOBS_SHEET_ID}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${env.JOBS_SHEET_ID}/gviz/tq?tqx=out:csv`,
    { redirect: 'manual' }
  );
  const type = res.headers.get('Content-Type') || '';
  if (!res.ok || !type.includes('csv')) {
    throw new Error(`Sheet lowongan tidak bisa dibaca (status ${res.status}). Pastikan di-share "Siapa saja yang memiliki link".`);
  }
  const rows = parseCsv(await res.text());
  const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const col = name => header.findIndex(h => h.startsWith(name));
  const iKat = col('kategori'), iJob = col('nama'), iStatus = col('status'), iKet = col('keterangan');

  const jobs = rows
    .map(r => ({
      kategori: normKategori(r[iKat]),
      job: String(r[iJob] || '').trim(),
      status: String(r[iStatus] ?? 'Buka').trim().toLowerCase(),
      keterangan: iKet >= 0 ? String(r[iKet] || '').trim() : ''
    }))
    .filter(j => j.kategori && j.job && j.status !== 'tutup')
    .map(({ kategori, job, keterangan }) => ({ kategori, job, keterangan }));

  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(jobs), {
    headers: { 'Cache-Control': `max-age=${JOBS_TTL}` }
  })));
  return jobs;
}

function normKategori(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'tg' || s.startsWith('tokutei') || s === 'ssw') return 'TG';
  if (s.startsWith('gijinkoku') || s.startsWith('gijutsu')) return 'Gijinkoku';
  return '';
}

/* ---------- Submit ---------- */

async function handleSubmit(request, env, ctx) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ ok: false, error: 'Akses ditolak.' }, 403);
  }

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: 'Data tidak valid.' }, 400); }

  if (data.website) return json({ ok: true, nama: 'kamu' }); // honeypot

  const nama = str(data.nama, 120);
  const hp = normHp(data.hp);
  const email = str(data.email, 160).toLowerCase();
  const alamat = str(data.alamat, 500);
  const level = String(data.level || '');
  const kategori = String(data.kategori || '');
  const job = str(data.job, 200);

  if (nama.length < 3) return bad('Nama lengkap minimal 3 huruf.');
  if (!/^\+?\d{9,15}$/.test(hp)) return bad('Nomor handphone tidak valid.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('Format email tidak valid.');
  if (alamat.length < 5) return bad('Alamat domisili terlalu pendek.');
  if (!LEVELS.includes(level)) return bad('Pilih level bahasa Jepang.');
  if (!KATEGORI.includes(kategori)) return bad('Pilih jenis visa / program (TG atau Gijinkoku).');

  try {
    const jobs = await getJobs(env, ctx);
    if (!jobs.some(j => j.kategori === kategori && j.job === job)) {
      return bad('Lowongan yang dipilih sudah tidak tersedia. Muat ulang halaman ya.');
    }
  } catch (e) {
    console.error('Jobs check failed', e);
    return json({ ok: false, error: 'Daftar lowongan sedang tidak bisa dimuat.' }, 502);
  }

  const timestamp = wibNow();
  try {
    await env.DB.prepare(
      'INSERT INTO pendaftar (created_at, nama, hp, email, alamat, level, kategori, job) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(timestamp, nama, hp, email, alamat, level, kategori, job).run();
  } catch (e) {
    console.error('D1 error', e);
    return json({ ok: false, error: 'Server sedang sibuk.' }, 500);
  }

  // Opsional: langsung append ke Google Sheets kalau service account dipasang
  if (env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY && env.SHEET_ID) {
    ctx.waitUntil(appendToSheet(env, [timestamp, nama, hp, email, alamat, level, kategori, job])
      .catch(e => console.error('Sheets append error', e)));
  }

  return json({ ok: true, nama });
}

/* ---------- Export CSV (untuk IMPORTDATA di Google Sheets) ---------- */

async function handleExport(url, env) {
  if (!env.EXPORT_KEY || !timingSafeEqual(url.searchParams.get('key') || '', env.EXPORT_KEY)) {
    return new Response('Forbidden', { status: 403 });
  }
  const { results } = await env.DB.prepare(
    'SELECT created_at, nama, hp, email, alamat, level, kategori, job FROM pendaftar ORDER BY id'
  ).all();
  const head = ['Timestamp (WIB)', 'Nama Lengkap', 'No Handphone', 'Email', 'Alamat Domisili',
    'Level Bahasa Jepang', 'Kategori', 'Job'];
  const lines = [head, ...results.map(r => [
    r.created_at, r.nama, displayHp(r.hp), r.email, r.alamat, r.level, r.kategori, r.job
  ])].map(row => row.map(csvCell).join(','));
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ---------- Google Sheets append (opsional, service account JWT RS256) ---------- */

async function appendToSheet(env, row) {
  const token = await getAccessToken(env);
  const range = encodeURIComponent(`${env.SHEET_TAB || 'Pendaftar'}!A:H`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${range}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
  if (!res.ok) throw new Error(`Sheets API ${res.status} ${await res.text()}`);
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const pem = env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`
    })
  });
  if (!res.ok) throw new Error('Token error ' + res.status + ' ' + (await res.text()));
  const { access_token, expires_in } = await res.json();
  cachedToken = { token: access_token, exp: now + expires_in };
  return access_token;
}

/* ---------- helpers ---------- */

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}
// Cegah formula injection di spreadsheet + escape CSV
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function normHp(v) {
  let s = String(v || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+62')) s = '0' + s.slice(3);
  else if (s.startsWith('62') && s.length >= 11) s = '0' + s.slice(2);
  return s;
}
// Pakai tanda "-" supaya spreadsheet tidak membuang angka 0 di depan
function displayHp(hp) {
  return /^0\d+$/.test(hp) ? hp.replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3') : hp;
}
function wibNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function str(v, max) { return String(v || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function bad(msg) { return json({ ok: false, error: msg }, 400); }
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });
}
