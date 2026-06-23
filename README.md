# ============================================================
# FILE: README.md
# SIG EV Station Medan — Dokumentasi Proyek
# Hikmal Akbar | 2305181024 | Teknologi Rekayasa Perangkat Lunak
# ============================================================

# ⚡ SIG EV Station Medan

Sistem Informasi Geografis berbasis web untuk pemetaan **Stasiun Pengisian Kendaraan Listrik Umum (SPKLU)** dan **Stasiun Penukaran Baterai Kendaraan Listrik Umum (SPBKLU)** di Kota Medan.

> **Tugas Akhir Praktikum Sistem Informasi Geografis**  
> Hikmal Akbar | NIM: 2305181024  
> Teknologi Rekayasa Perangkat Lunak — Politeknik Negeri Medan

---

## 📁 Struktur Proyek

```
sig-ev-station/
├── .env.example              ← Salin ke .env dan isi nilainya
├── .env                      ← JANGAN di-commit ke Git!
├── package.json
├── server.js                 ← Entry point Express
│
├── config/
│   ├── db.js                 ← Koneksi PostgreSQL + PostGIS
│   └── cloudinary.js         ← Konfigurasi Cloudinary
│
├── middleware/
│   ├── auth.middleware.js    ← JWT verify + role guard
│   └── upload.middleware.js  ← Multer memory storage
│
├── controllers/
│   ├── auth.controller.js    ← Google OAuth + JWT
│   ├── stasiun.controller.js ← CRUD + PostGIS queries
│   ├── upload.controller.js  ← Upload ke Cloudinary
│   └── report.controller.js  ← Analisis spasial
│
├── routes/
│   ├── auth.routes.js
│   ├── stasiun.routes.js
│   ├── upload.routes.js
│   └── report.routes.js
│
├── sql/
│   └── part1-database.sql    ← CREATE TABLE + INSERT data awal
│
└── frontend/
    ├── index.html            ← Landing page (animasi lengkap)
    ├── map.html              ← Peta interaktif Leaflet
    ├── login.html            ← Login Google OAuth
    ├── stasiun.html          ← Detail stasiun
    ├── dashboard.html        ← Dashboard user & admin
    └── report.html           ← Laporan akademik + profil
```

---

## 🚀 Cara Menjalankan

### 1. Persiapan Database

```bash
# Buat database (jalankan sebagai superuser PostgreSQL)
psql -U postgres -c "CREATE DATABASE sig_ev_medan;"

# Jalankan script SQL (termasuk ekstensi PostGIS + data awal)
psql -U postgres -d sig_ev_medan -f sql/part1-database.sql
```

### 2. Setup Backend

```bash
# Install dependencies
npm install

# Salin dan isi environment variables
cp .env.example .env
# Edit .env dengan text editor favorit Anda

# Jalankan server (development)
npm run dev

# Atau production
npm start
```

### 3. Jalankan Frontend

Buka folder `frontend/` dengan **VS Code Live Server** (port 5500) atau HTTP server sederhana:

```bash
# Menggunakan Python (dari folder frontend)
cd frontend
python -m http.server 5500

# Atau menggunakan npx
npx serve frontend -p 5500
```

npx serve . -p 5500

Buka browser: `http://127.0.0.1:5500`

---

## 🗄️ Database Schema

```sql
users           -- Akun pengguna (Google OAuth)
stasiun         -- SPKLU & SPBKLU (GEOMETRY POINT, SRID 4326)
unit_pengisian  -- Unit charger pada SPKLU
port            -- Konektor (CCS2, CHAdeMO, Type 2, dll)
kabinet_swap    -- Kabinet swap baterai pada SPBKLU
baterai_swap    -- Slot baterai dalam kabinet
kecamatan       -- Polygon 21 kecamatan Medan (GEOMETRY POLYGON)
```

### Spatial Indexes

```sql
CREATE INDEX idx_stasiun_geom  ON stasiun   USING GIST (geom);
CREATE INDEX idx_kecamatan_geom ON kecamatan USING GIST (geom);
```

---

## 🔍 Query PostGIS yang Diimplementasikan

| No | Query | Endpoint |
|----|-------|----------|
| 1 | `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` — INSERT titik | `POST /api/stasiun` |
| 2 | `ORDER BY geom <-> point LIMIT N` — Nearest Neighbor (KNN) | `GET /api/stasiun/nearby` |
| 3 | `ST_DWithin(::geography, radius_m)` — Analisis Radius | `GET /api/stasiun/within-radius` |
| 4 | `ST_Within(s.geom, k.geom)` — Intersect Polygon | `GET /api/report/analisis` |
| 5 | `ST_Buffer(geom::geography, radius)` — Buffer Area | `GET /api/report/buffer` |
| 6 | `ST_Area(geom::geography) / 1000000` — Luas Kecamatan (km²) | `GET /api/report/analisis` |

---

## 🌐 API Endpoints

### Auth
```
POST /api/auth/google     -- Login dengan Google credential
GET  /api/auth/me         -- Profil user (JWT required)
```

### Stasiun
```
GET  /api/stasiun                    -- Semua stasiun (GeoJSON)
GET  /api/stasiun/nearby             -- Nearest Neighbor (KNN)
GET  /api/stasiun/within-radius      -- Radius ST_DWithin
GET  /api/stasiun/kecamatan-list     -- List kecamatan + count
GET  /api/stasiun/kecamatan/:nama    -- Stasiun per kecamatan
GET  /api/stasiun/user/milik-saya    -- Stasiun milik user (JWT)
GET  /api/stasiun/:id                -- Detail stasiun
POST /api/stasiun                    -- Tambah stasiun (JWT)
PUT  /api/stasiun/:id                -- Update stasiun (JWT)
DEL  /api/stasiun/:id                -- Hapus stasiun (JWT)
```

### Upload
```
POST /api/upload                     -- Upload foto ke Cloudinary (JWT)
```

### Report
```
GET /api/report/analisis             -- Analisis spasial lengkap
GET /api/report/geojson-kecamatan   -- GeoJSON polygon kecamatan
GET /api/report/buffer               -- Buffer ST_Buffer
GET /api/report/foto-acak            -- Foto acak untuk carousel
GET /api/report/explain-analyze      -- EXPLAIN ANALYZE (proof of index)
GET /api/health                      -- Health check
```

---

## ⚙️ Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Database | PostgreSQL 15 + PostGIS 3.3 |
| Backend | Node.js 20 + Express 4 |
| ORM / Query | node-postgres (`pg`) |
| Auth | Google OAuth 2.0 + JWT (`jsonwebtoken`) |
| File Upload | Cloudinary + Multer |
| Frontend Map | Leaflet.js 1.9 + MarkerCluster |
| Animasi | AOS.js + CSS Animations |
| Font | Inter + Space Grotesk (Google Fonts) |

---

## 👤 Mahasiswa

**Hikmal Akbar**  
NIM: 2305181024  
Program Studi: Teknologi Rekayasa Perangkat Lunak  
Jurusan: Teknik Komputer dan Informatika  
Politeknik Negeri Medan

---

## 📝 Lisensi

Proyek ini dibuat untuk keperluan akademik — Tugas Akhir Praktikum SIG Semester Genap 2024.