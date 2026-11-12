# daftar-job.iranza.com

Form pendaftaran job Jepang (TG / Gijinkoku) — Cloudflare Worker + D1 + Google Sheets.

## Alur data
- **Lowongan** dibaca dari Google Sheet *"Daftar Lowongan - daftar-job.iranza.com"*
  (kolom: `Kategori | Nama Job | Status | Keterangan`).
  - `Kategori`: `TG` atau `Gijinkoku`
  - `Status`: `Buka` / `Tutup` (Tutup = tidak muncul di form)
  - Perubahan muncul di form dalam ±1 menit.
  - Sheet ini harus di-share **"Siapa saja yang memiliki link → Viewer"** (isinya cuma nama job).
- **Pendaftar** disimpan di D1 (`daftar-job`, tabel `pendaftar`), lalu ditarik ke spreadsheet
  *"Pendaftar - daftar-job.iranza.com"* lewat rumus `IMPORTDATA` ke `/export.csv?key=EXPORT_KEY`
  (Google refresh otomatis ±1 jam; spreadsheet ini tetap private).
- Opsional real-time: isi `SHEET_ID`, `SHEET_TAB`, secret `GOOGLE_SA_EMAIL` & `GOOGLE_SA_KEY`
  (service account Google, share sheet ke `client_email` sbg Editor) → tiap pendaftar langsung di-append.

## Deploy
```bash
npm i -g wrangler && wrangler login
cd daftar-job
wrangler d1 execute daftar-job --remote --file=schema.sql   # sekali saja
wrangler secret put EXPORT_KEY
wrangler deploy
```
Log error: `wrangler tail daftar-job`.
