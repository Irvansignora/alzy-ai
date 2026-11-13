/**
 * Sinkron sheet "Pendaftar" dengan https://daftar-job.iranza.com — hampir real-time.
 *
 * Cara pasang (sekali saja, dari akun pemilik spreadsheet):
 *  1. Buka spreadsheet "Pendaftar - daftar-job.iranza.com" → Ekstensi → Apps Script.
 *  2. Hapus isi Code.gs, tempel seluruh file ini, ganti EXPORT_KEY, lalu Simpan.
 *  3. Pilih fungsi `setup` → Jalankan → izinkan akses (Advanced → Go to … → Allow).
 *     Ini membuat tab "Pendaftar", mengisi data, dan memasang sinkron otomatis tiap 5 menit.
 *  4. Deploy → New deployment → jenis "Web app" → Execute as: Me, Who has access: Anyone → Deploy.
 *     Salin "Web app URL" (…/exec) dan simpan sebagai secret SHEET_WEBHOOK di worker.
 *     Setelah itu, setiap pendaftar baru / data yang dihapus di admin langsung masuk ke sheet.
 *
 * Catatan: tab "Pendaftar" ditulis ulang setiap sinkron. Untuk catatan sendiri, pakai tab lain.
 */
const EXPORT_URL = 'https://daftar-job.iranza.com/export.csv';
const EXPORT_KEY = 'GANTI_DENGAN_EXPORT_KEY';
const TAB = 'Pendaftar';

function sync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'busy';
  try {
    const res = UrlFetchApp.fetch(EXPORT_URL + '?key=' + encodeURIComponent(EXPORT_KEY), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Export gagal: HTTP ' + res.getResponseCode());
    const rows = Utilities.parseCsv(res.getContentText('UTF-8'));
    if (!rows.length) return 'empty';

    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB, 0);
    const cols = rows[0].length;
    const data = rows.map(r => {                      // pastikan semua baris sama panjang
      const x = r.slice(0, cols);
      while (x.length < cols) x.push('');
      return x;
    });

    sh.clearContents();
    const range = sh.getRange(1, 1, data.length, cols);
    range.setNumberFormat('@');                       // teks apa adanya: 0 di depan no HP aman
    range.setValues(data);
    sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#e0e7ff');
    sh.setFrozenRows(1);
    if (sh.getMaxRows() > data.length + 1) {          // buang sisa baris lama (data yang dihapus)
      sh.getRange(data.length + 1, 1, sh.getMaxRows() - data.length, sh.getMaxColumns()).clearContent();
    }
    return 'ok ' + (data.length - 1);
  } finally {
    lock.releaseLock();
  }
}

// Dipanggil worker setiap ada pendaftar baru / data dihapus
function doPost(e) { return handle_(e); }
function doGet(e) { return handle_(e); }
function handle_(e) {
  const key = e && e.parameter && e.parameter.key;
  if (key !== EXPORT_KEY) return ContentService.createTextOutput('forbidden');
  return ContentService.createTextOutput(sync());
}

// Jalankan sekali: isi data sekarang + pasang sinkron otomatis tiap 5 menit (cadangan)
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sync')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  const r = sync();
  const ss = SpreadsheetApp.getActive();
  const old = ss.getSheets()[0];                      // tab lama berisi =IMPORTDATA(...) tidak dipakai lagi
  if (old.getName() !== TAB && /IMPORTDATA/i.test(old.getRange('A1').getFormula())) old.getRange('A1').clearContent();
  return r;
}
