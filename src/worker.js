/**
 * daftar-job.iranza.com — Form pendaftaran job (TG / Gijinkoku)
 *
 * Routes:
 *   GET  /              -> halaman form
 *   GET  /api/jobs      -> daftar lowongan (dibaca dari Google Sheet "Daftar Lowongan")
 *   POST /api/submit    -> simpan pendaftar ke D1 + file CV/sertifikat ke R2
 *   GET  /export.csv?key=EXPORT_KEY -> semua pendaftar sbg CSV (dipakai IMPORTDATA di spreadsheet)
 *   GET  /file/<key>?sig=...        -> download CV / sertifikat (link bertanda tangan, ada di spreadsheet)
 *
 * Bindings / vars:
 *   DB              D1 database (tabel `pendaftar`, lihat schema.sql)
 *   FILES           R2 bucket untuk CV & sertifikat
 *   JOBS_SHEET_ID   ID Google Sheet lowongan. Kalau sheet tidak bisa dibaca (belum di-share
 *                   "Siapa saja yang memiliki link - Viewer"), dipakai DEFAULT_JOBS di bawah.
 *   EXPORT_KEY      (secret) kunci untuk /export.csv & tanda tangan link file
 */
import FORM_HTML from './form.html';

const LEVELS = [
  'Belum pernah belajar',
  'Pemula (belum bersertifikat)',
  'JLPT N5', 'JLPT N4', 'JLPT N3', 'JLPT N2', 'JLPT N1',
  'JFT-Basic A2'
];
const KATEGORI = ['TG', 'Gijinkoku'];
const CERT_LEVELS = LEVELS.filter(l => l.startsWith('JLPT') || l.startsWith('JFT'));
const MAX_FILE = 5 * 1024 * 1024; // 5 MB per file

// Lowongan bawaan — dipakai kalau sheet "Daftar Lowongan" belum bisa dibaca
const DEFAULT_JOBS = [
  ['TG', 'Pertanian (Nogyo)', 'Tanam sayur, buah, rumah kaca'],
  ['TG', 'Peternakan (Chikusan)', 'Sapi, babi, ayam, susu'],
  ['TG', 'Restoran / Food Service (Gaishoku)', 'Dapur & pelayanan'],
  ['TG', 'Pengolahan Makanan & Minuman', 'Pabrik makanan, bento, roti'],
  ['TG', 'Perawat Lansia (Kaigo)', ''],
  ['TG', 'Perhotelan (Shukuhaku)', 'Front office, housekeeping'],
  ['TG', 'Konstruksi (Kensetsu)', ''],
  ['TG', 'Manufaktur / Pabrik (Kogyo Seihin)', 'Mesin, elektronik, logam'],
  ['TG', 'Cleaning Service Gedung', ''],
  ['TG', 'Perikanan (Gyogyo)', 'Penangkapan & budidaya'],
  ['TG', 'Perbaikan Mobil (Jidosha Seibi)', ''],
  ['TG', 'Perkapalan', ''],
  ['TG', 'Bandara / Aviasi', 'Ground handling, perawatan pesawat'],
  ['TG', 'Supir / Logistik (Jidosha Unso)', 'Truk, bus, taksi'],
  ['Gijinkoku', 'IT / Software Engineer', 'Programmer, web, infrastruktur'],
  ['Gijinkoku', 'Perhotelan (Front Office / Guest Service)', ''],
  ['Gijinkoku', 'Engineer Mesin', ''],
  ['Gijinkoku', 'Engineer Elektro', ''],
  ['Gijinkoku', 'Engineer Sipil / Arsitek / CAD', ''],
  ['Gijinkoku', 'Interpreter / Penerjemah', ''],
  ['Gijinkoku', 'Admin / Staf Kantor', ''],
  ['Gijinkoku', 'Marketing / Sales', ''],
  ['Gijinkoku', 'Akuntansi / Keuangan', ''],
  ['Gijinkoku', 'Trading / Ekspor-Impor / Logistik', '']
].map(([kategori, job, keterangan]) => ({ kategori, job, keterangan }));
const JOBS_TTL = 60; // detik — perubahan di sheet lowongan muncul di form maks ±1 menit

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
    if (method === 'GET' && url.pathname.startsWith('/file/')) return handleFile(url, env);

    return new Response('Not found', { status: 404 });
  }
};

/* ---------- Lowongan (dari Google Sheet) ---------- */

async function getJobs(env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://jobs-cache.internal/${env.JOBS_SHEET_ID}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  let jobs = DEFAULT_JOBS;
  try { jobs = await fetchSheetJobs(env); }
  catch (e) { console.warn('Pakai DEFAULT_JOBS:', e.message); }

  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(jobs), {
    headers: { 'Cache-Control': `max-age=${JOBS_TTL}` }
  })));
  return jobs;
}

async function fetchSheetJobs(env) {
  if (!env.JOBS_SHEET_ID) throw new Error('JOBS_SHEET_ID kosong');
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
  if (!jobs.length) throw new Error('Sheet lowongan kosong');
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

  let fd;
  try { fd = await request.formData(); }
  catch { return json({ ok: false, error: 'Data tidak valid.' }, 400); }
  const data = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

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

  const cv = await readFile(fd.get('cv'));
  if (!cv) return bad('Upload CV dulu (PDF/JPG/PNG, maks 5 MB).');
  if (cv.error) return bad('CV: ' + cv.error);
  const cert = await readFile(fd.get('sertifikat'));
  if (cert && cert.error) return bad('Sertifikat: ' + cert.error);
  if (!cert && CERT_LEVELS.includes(level)) return bad('Upload sertifikat bahasa Jepang (' + level + ').');

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
  const base = `${timestamp.slice(0, 7)}/${timestamp.slice(0, 10)}-${slug(nama)}-${randomId()}`;
  const cvKey = `${base}/CV.${cv.ext}`;
  const certKey = cert ? `${base}/Sertifikat.${cert.ext}` : null;
  try {
    await env.FILES.put(cvKey, cv.bytes, { httpMetadata: { contentType: cv.type } });
    if (cert) await env.FILES.put(certKey, cert.bytes, { httpMetadata: { contentType: cert.type } });
  } catch (e) {
    console.error('R2 error', e);
    return json({ ok: false, error: 'Upload file gagal.' }, 500);
  }
  try {
    await env.DB.prepare(
      'INSERT INTO pendaftar (created_at, nama, hp, email, alamat, level, kategori, job, cv_key, sertifikat_key) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(timestamp, nama, hp, email, alamat, level, kategori, job, cvKey, certKey).run();
  } catch (e) {
    console.error('D1 error', e);
    return json({ ok: false, error: 'Server sedang sibuk.' }, 500);
  }

  return json({ ok: true, nama });
}

/* ---------- Export CSV (untuk IMPORTDATA di Google Sheets) ---------- */

async function handleExport(url, env) {
  if (!env.EXPORT_KEY || !timingSafeEqual(url.searchParams.get('key') || '', env.EXPORT_KEY)) {
    return new Response('Forbidden', { status: 403 });
  }
  const { results } = await env.DB.prepare(
    'SELECT created_at, nama, hp, email, alamat, level, kategori, job, cv_key, sertifikat_key FROM pendaftar ORDER BY id'
  ).all();
  const head = ['Timestamp (WIB)', 'Nama Lengkap', 'No Handphone', 'Email', 'Alamat Domisili',
    'Level Bahasa Jepang', 'Kategori', 'Job', 'CV (link download)', 'Sertifikat (link download)'];
  const link = async k => k ? `https://${url.host}/file/${encodeURI(k)}?sig=${await sign(env, k)}` : '';
  const rows = await Promise.all(results.map(async r => [
    r.created_at, r.nama, displayHp(r.hp), r.email, r.alamat, r.level, r.kategori, r.job,
    await link(r.cv_key), await link(r.sertifikat_key)
  ]));
  const lines = [head, ...rows].map(row => row.map(csvCell).join(','));
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ---------- File CV / sertifikat ---------- */

async function handleFile(url, env) {
  const key = decodeURI(url.pathname.slice('/file/'.length));
  const sig = url.searchParams.get('sig') || '';
  if (!env.EXPORT_KEY || !key || !timingSafeEqual(sig, await sign(env, key))) {
    return new Response('Link tidak valid.', { status: 403 });
  }
  const obj = await env.FILES.get(key);
  if (!obj) return new Response('File tidak ditemukan.', { status: 404 });
  const name = key.split('/').slice(-2).join('-');
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// Cek file: wajib PDF/JPG/PNG (dicek dari isi file, bukan nama) dan maks 5 MB
async function readFile(f) {
  if (!f || typeof f === 'string' || !f.size) return null;
  if (f.size > MAX_FILE) return { error: 'ukuran maksimal 5 MB.' };
  const bytes = new Uint8Array(await f.arrayBuffer());
  const h = bytes.subarray(0, 8);
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return { bytes, ext: 'pdf', type: 'application/pdf' };
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { bytes, ext: 'jpg', type: 'image/jpeg' };
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return { bytes, ext: 'png', type: 'image/png' };
  return { error: 'format harus PDF, JPG, atau PNG.' };
}

async function sign(env, key) {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.EXPORT_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('file:' + key));
  return b64url(mac);
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
function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pendaftar';
}
function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
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
