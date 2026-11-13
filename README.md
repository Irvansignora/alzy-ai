# daftar-job.iranza.com

Form pendaftaran job Jepang (**TG** / **Gijinkoku**) — Cloudflare Worker + D1 + R2 + Google Sheets.

Live: https://daftar-job.iranza.com

## Alur data
- **Lowongan**: dibaca dari Google Sheet *"Daftar Lowongan - daftar-job.iranza.com"*
  (kolom `Kategori | Nama Job | Status | Keterangan`).
  - `Kategori`: `TG` atau `Gijinkoku` — user pilih program dulu, dropdown job menyesuaikan.
  - `Status`: `Buka` / `Tutup` (Tutup = tidak muncul di form). Perubahan muncul ±1 menit.
  - Sheet harus di-share **"Siapa saja yang memiliki link → Viewer"**. Selama belum bisa dibaca,
    form memakai daftar bawaan `DEFAULT_JOBS` di `src/worker.js`.
- **Pendaftar**: disimpan di D1 (`daftar-job`, tabel `pendaftar`).
- **CV & sertifikat** (PDF/JPG/PNG, maks 5 MB): disimpan di R2 (`daftar-job-files`).
  CV wajib; sertifikat wajib kalau level JLPT / JFT-Basic.
- **Spreadsheet "Pendaftar"** disinkronkan oleh Google Apps Script (`apps-script/Sync.gs`) yang menarik
  `/export.csv?key=EXPORT_KEY`, termasuk link download CV & sertifikat (link ditandatangani HMAC).
  Worker memanggil web app script itu (`SHEET_WEBHOOK`) setiap ada pendaftar baru / data dihapus,
  jadi sheet ter-update dalam hitungan detik; ada juga sinkron otomatis tiap 5 menit sebagai cadangan.
  Script menulis tab "Pendaftar" (semua), "Kandidat TG" dan "Kandidat Gijinkoku".
  Cara pasang ada di kepala file `apps-script/Sync.gs`. Jangan share spreadsheet ini ke publik.

## Halaman admin
https://daftar-job.iranza.com/admin — lihat, cari, filter (TG / Gijinkoku / dobel), buka CV & sertifikat,
chat WhatsApp, dan hapus pendaftar (satu-satu atau sekaligus; file di R2 ikut terhapus).
- Dikunci **Cloudflare Access** (app *daftar-job admin*, login kode OTP ke email). Email yang boleh masuk
  diatur di policy Access **dan** di `ADMIN_EMAILS` (worker juga memverifikasi JWT Access).
- Pendaftaran dengan no HP / email yang sama untuk job yang sama otomatis ditolak.

## Endpoint
| Method | Path | Fungsi |
|---|---|---|
| GET | `/` | Halaman form |
| GET | `/api/jobs` | Daftar lowongan |
| POST | `/api/submit` | Kirim pendaftaran (multipart/form-data) |
| GET | `/export.csv?key=…` | Semua pendaftar (CSV) |
| GET | `/file/<key>?sig=…` | Download CV / sertifikat |
| GET | `/admin` | Halaman admin (Cloudflare Access) |
| GET | `/admin/api/list` | Data pendaftar + penanda dobel |
| POST | `/admin/api/delete` | Hapus pendaftar `{ ids: [...] }` |
| GET | `/admin/file/<key>` | Lihat CV / sertifikat |

## Deploy
```bash
npm i -g wrangler && wrangler login
wrangler d1 execute daftar-job --remote --file=schema.sql   # sekali saja
wrangler secret put EXPORT_KEY
wrangler deploy
```
Tes lokal: buat `.dev.vars` berisi `EXPORT_KEY=apa-saja`, lalu
`wrangler d1 execute daftar-job --local --file=schema.sql && wrangler dev`.

Log error: `wrangler tail daftar-job`.
