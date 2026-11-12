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
- **Spreadsheet "Pendaftar"** menarik semua data via
  `=IMPORTDATA("https://daftar-job.iranza.com/export.csv?key=EXPORT_KEY")` (refresh ±1 jam),
  termasuk link download CV & sertifikat. Link file ditandatangani (HMAC) — tanpa `sig` yang benar = 403.
  Jangan share spreadsheet ini ke publik.

## Endpoint
| Method | Path | Fungsi |
|---|---|---|
| GET | `/` | Halaman form |
| GET | `/api/jobs` | Daftar lowongan |
| POST | `/api/submit` | Kirim pendaftaran (multipart/form-data) |
| GET | `/export.csv?key=…` | Semua pendaftar (CSV) |
| GET | `/file/<key>?sig=…` | Download CV / sertifikat |

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
