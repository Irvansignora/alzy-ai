CREATE TABLE IF NOT EXISTS pendaftar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  nama TEXT NOT NULL,
  hp TEXT NOT NULL,
  email TEXT NOT NULL,
  alamat TEXT NOT NULL,
  level TEXT NOT NULL,
  kategori TEXT NOT NULL,
  job TEXT NOT NULL,
  cv_key TEXT,
  sertifikat_key TEXT
);
