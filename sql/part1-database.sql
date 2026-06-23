-- ============================================================
-- SIG EV STATION MEDAN
-- Part 1: Database Setup
-- Mahasiswa: Hikmal Akbar | NIM: 2305181024
-- Prodi: Teknologi Rekayasa Perangkat Lunak
-- ============================================================
-- Jalankan di psql atau pgAdmin dengan user superuser
-- Pastikan PostgreSQL dan PostGIS sudah terinstall
-- ============================================================

-- 1. Buat database (jalankan sebagai superuser di luar db ini)
-- CREATE DATABASE sig_ev_medan;
-- \c sig_ev_medan

-- 2. Aktifkan ekstensi PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- ============================================================
-- TABEL: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    google_id   VARCHAR(100) UNIQUE,
    email       VARCHAR(255) NOT NULL,
    name        VARCHAR(255),
    avatar_url  TEXT,
    role        VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at  TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Tabel pengguna aplikasi. Role admin dapat CRUD semua stasiun, user hanya miliknya.';

-- ============================================================
-- TABEL: stasiun (tabel utama dengan kolom geometri PostGIS)
-- ============================================================
CREATE TABLE IF NOT EXISTS stasiun (
    id               SERIAL PRIMARY KEY,
    nama             VARCHAR(255) NOT NULL,
    jenis            VARCHAR(10)  NOT NULL CHECK (jenis IN ('SPKLU', 'SPBKLU')),
    badan_usaha      VARCHAR(255),
    provider         VARCHAR(255),
    alamat           TEXT,
    kota             VARCHAR(100) DEFAULT 'KOTA MEDAN',
    latitude         NUMERIC(12, 10) NOT NULL,
    longitude        NUMERIC(12, 10) NOT NULL,
    geom             GEOMETRY(POINT, 4326) NOT NULL,
    status           VARCHAR(50) DEFAULT 'Beroperasi',
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMP DEFAULT NOW(),
    foto_stasiun_url TEXT
);

-- Spatial index untuk query PostGIS yang cepat
CREATE INDEX IF NOT EXISTS idx_stasiun_geom ON stasiun USING GIST (geom);
-- Index tambahan untuk filter umum
CREATE INDEX IF NOT EXISTS idx_stasiun_jenis ON stasiun (jenis);
CREATE INDEX IF NOT EXISTS idx_stasiun_status ON stasiun (status);

COMMENT ON TABLE stasiun IS 'Stasiun pengisian kendaraan listrik (SPKLU & SPBKLU) di Kota Medan. Kolom geom bertipe POINT SRID 4326.';

-- ============================================================
-- TABEL: unit_pengisian (untuk SPKLU)
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_pengisian (
    id                SERIAL PRIMARY KEY,
    stasiun_id        INTEGER REFERENCES stasiun(id) ON DELETE CASCADE,
    nama_unit         VARCHAR(100),
    nomor_identitas   VARCHAR(100),
    tipe_charger      VARCHAR(50),   -- Fast, Ultra Fast, Medium, Slow
    daya_min_kw       INTEGER,
    daya_max_kw       INTEGER,
    harga_per_kwh     VARCHAR(50),
    biaya_layanan     VARCHAR(50)
);

COMMENT ON TABLE unit_pengisian IS 'Unit charger pada setiap SPKLU. Satu stasiun dapat memiliki banyak unit.';

-- ============================================================
-- TABEL: port (konektor pada setiap unit)
-- ============================================================
CREATE TABLE IF NOT EXISTS port (
    id           SERIAL PRIMARY KEY,
    unit_id      INTEGER REFERENCES unit_pengisian(id) ON DELETE CASCADE,
    jenis_port   VARCHAR(30),   -- CCS2, CHAdeMO, Type 2, AC, dll
    status_port  VARCHAR(30)    -- Tersedia, Digunakan, Rusak
);

COMMENT ON TABLE port IS 'Port/konektor pada setiap unit pengisian. Satu unit dapat memiliki beberapa port.';

-- ============================================================
-- TABEL: kabinet_swap (untuk SPBKLU)
-- ============================================================
CREATE TABLE IF NOT EXISTS kabinet_swap (
    id                SERIAL PRIMARY KEY,
    stasiun_id        INTEGER REFERENCES stasiun(id) ON DELETE CASCADE,
    nama_kabinet      VARCHAR(100),
    kapasitas_baterai INTEGER,   -- jumlah slot baterai
    harga_penukaran   VARCHAR(50)
);

COMMENT ON TABLE kabinet_swap IS 'Kabinet swap baterai pada stasiun SPBKLU.';

-- ============================================================
-- TABEL: baterai_swap (baterai dalam kabinet)
-- ============================================================
CREATE TABLE IF NOT EXISTS baterai_swap (
    id            SERIAL PRIMARY KEY,
    kabinet_id    INTEGER REFERENCES kabinet_swap(id) ON DELETE CASCADE,
    kapasitas_ah  VARCHAR(20),
    level_persen  INTEGER CHECK (level_persen BETWEEN 0 AND 100),
    jenis_sel     VARCHAR(20),   -- Li-ion, LiFePO4, dll
    ketersediaan  VARCHAR(20)    -- Tersedia, Sedang Digunakan
);

COMMENT ON TABLE baterai_swap IS 'Data baterai di dalam setiap kabinet swap.';

-- ============================================================
-- TABEL: kecamatan (polygon wilayah administrasi)
-- ============================================================
CREATE TABLE IF NOT EXISTS kecamatan (
    id               SERIAL PRIMARY KEY,
    nama_kecamatan   VARCHAR(100),
    geom             GEOMETRY(POLYGON, 4326)
);

CREATE INDEX IF NOT EXISTS idx_kecamatan_geom ON kecamatan USING GIST (geom);

COMMENT ON TABLE kecamatan IS 'Batas wilayah kecamatan di Kota Medan (19 kecamatan). Digunakan untuk analisis intersect.';

-- ============================================================
-- VIEW: stasiun_per_kecamatan (agregasi spasial)
-- ============================================================
CREATE OR REPLACE VIEW v_stasiun_per_kecamatan AS
SELECT
    k.id,
    k.nama_kecamatan,
    COUNT(s.id) AS jumlah_stasiun,
    COUNT(s.id) FILTER (WHERE s.jenis = 'SPKLU')  AS jumlah_spklu,
    COUNT(s.id) FILTER (WHERE s.jenis = 'SPBKLU') AS jumlah_spbklu
FROM kecamatan k
LEFT JOIN stasiun s ON ST_Within(s.geom, k.geom)
GROUP BY k.id, k.nama_kecamatan
ORDER BY jumlah_stasiun DESC;

COMMENT ON VIEW v_stasiun_per_kecamatan IS 'View agregasi: jumlah stasiun per kecamatan menggunakan ST_Within.';

-- ============================================================
-- MATERIALIZED VIEW: statistik harian (untuk laporan cepat)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_statistik_stasiun AS
SELECT
    jenis,
    COUNT(*)                        AS total,
    COUNT(*) FILTER (WHERE status = 'Beroperasi')    AS aktif,
    COUNT(*) FILTER (WHERE status != 'Beroperasi')   AS tidak_aktif,
    MAX(created_at)                 AS terakhir_ditambahkan
FROM stasiun
GROUP BY jenis;

-- Refresh dengan: REFRESH MATERIALIZED VIEW mv_statistik_stasiun;
COMMENT ON MATERIALIZED VIEW mv_statistik_stasiun IS 'Statistik ringkas stasiun per jenis. Refresh manual setelah perubahan data.';

-- ============================================================
-- INSERT DATA AWAL: Admin default
-- ============================================================
INSERT INTO users (google_id, email, name, role) VALUES
('admin_default_001', 'hikmal.akbar@admin.com', 'Hikmal Akbar (Admin)', 'admin')
ON CONFLICT (google_id) DO NOTHING;

-- ============================================================
-- INSERT DATA: SPKLU di Kota Medan (24 stasiun)
-- Sumber: Google Maps + data lapangan
-- Format geom: ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
-- ============================================================

INSERT INTO stasiun (nama, jenis, badan_usaha, provider, alamat, kota, latitude, longitude, geom, status, created_by, foto_stasiun_url) VALUES

-- 1
('SPKLU PLN Medan Baru',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Listrik No.1, Medan Baru, Kota Medan',
 'KOTA MEDAN', 3.5919690000, 98.6662450000,
 ST_SetSRID(ST_MakePoint(98.6662450, 3.5919690), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 2
('SPKLU Sun Plaza Medan',
 'SPKLU', 'PT Pertamina (Persero)', 'MyPertamina',
 'Jl. K.H. Zainul Arifin No.7, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5873620000, 98.6699870000,
 ST_SetSRID(ST_MakePoint(98.6699870, 3.5873620), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 3
('SPKLU Medan Mal',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. MT. Haryono No.8, Kelurahan Gang Buntu, Medan Timur',
 'KOTA MEDAN', 3.5997340000, 98.6878120000,
 ST_SetSRID(ST_MakePoint(98.6878120, 3.5997340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 4
('SPKLU Cambridge City Square',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. S. Parman No.217, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5934500000, 98.6597120000,
 ST_SetSRID(ST_MakePoint(98.6597120, 3.5934500), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 5
('SPKLU Plaza Millenium Medan',
 'SPKLU', 'Starvo', 'Starvo EV',
 'Jl. Kapten Maulana Lubis No.8, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5906780000, 98.6706230000,
 ST_SetSRID(ST_MakePoint(98.6706230, 3.5906780), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 6
('SPKLU Hotel Santika Dyandra',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Imam Bonjol No.7, Petisah Hulu, Medan Petisah',
 'KOTA MEDAN', 3.5854320000, 98.6651430000,
 ST_SetSRID(ST_MakePoint(98.6651430, 3.5854320), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 7
('SPKLU Carrefour Citra Garden',
 'SPKLU', 'PT Pertamina (Persero)', 'MyPertamina',
 'Jl. Gatot Subroto No.30, Sei Sikambing B, Medan Sunggal',
 'KOTA MEDAN', 3.5854090000, 98.6479230000,
 ST_SetSRID(ST_MakePoint(98.6479230, 3.5854090), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 8
('SPKLU SPBU Pertamina Jl. Yos Sudarso',
 'SPKLU', 'PT Pertamina (Persero)', 'MyPertamina',
 'Jl. Yos Sudarso No.288, Mabar, Medan Deli',
 'KOTA MEDAN', 3.6239870000, 98.7010560000,
 ST_SetSRID(ST_MakePoint(98.7010560, 3.6239870), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 9
('SPKLU PLN UP3 Medan',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Listrik No.8, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5920000000, 98.6630000000,
 ST_SetSRID(ST_MakePoint(98.6630000, 3.5920000), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 10
('SPKLU Grand Aston Hotel Medan',
 'SPKLU', 'Starvo', 'Starvo EV',
 'Jl. Balai Kota No.1, Kelurahan Kesawan, Medan Barat',
 'KOTA MEDAN', 3.5899450000, 98.6760230000,
 ST_SetSRID(ST_MakePoint(98.6760230, 3.5899450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 11
('SPKLU SPBU Pertamina Jl. Sisingamangaraja',
 'SPKLU', 'PT Pertamina (Persero)', 'MyPertamina',
 'Jl. Sisingamangaraja No.356, Teladan Barat, Medan Kota',
 'KOTA MEDAN', 3.5712340000, 98.6789560000,
 ST_SetSRID(ST_MakePoint(98.6789560, 3.5712340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 12
('SPKLU Hermes Palace Hotel',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Guru Patimpus No.1-7, Petisah Hulu, Medan Petisah',
 'KOTA MEDAN', 3.5880230000, 98.6712340000,
 ST_SetSRID(ST_MakePoint(98.6712340, 3.5880230), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 13
('SPKLU Parkson Medan Fair',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Gatot Subroto No.30, Sekip, Medan Petisah',
 'KOTA MEDAN', 3.5832120000, 98.6601230000,
 ST_SetSRID(ST_MakePoint(98.6601230, 3.5832120), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 14
('SPKLU Hotel JW Marriott Medan',
 'SPKLU', 'Starvo', 'Starvo EV',
 'Jl. S. Parman No.253, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5920010000, 98.6596780000,
 ST_SetSRID(ST_MakePoint(98.6596780, 3.5920010), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 15
('SPKLU Hyatt Regency Medan',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Kapten Maulana Lubis No.17, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5912340000, 98.6680120000,
 ST_SetSRID(ST_MakePoint(98.6680120, 3.5912340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 16
('SPKLU SPBU Pertamina Polonia',
 'SPKLU', 'PT Pertamina (Persero)', 'MyPertamina',
 'Jl. Kolonel Sugiono No.12, Polonia, Medan Polonia',
 'KOTA MEDAN', 3.5713210000, 98.6679230000,
 ST_SetSRID(ST_MakePoint(98.6679230, 3.5713210), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 17
('SPKLU Mal Center Point Medan',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Jend. Ahmad Yani No.46, Gang Buntu, Medan Timur',
 'KOTA MEDAN', 3.5952340000, 98.6891230000,
 ST_SetSRID(ST_MakePoint(98.6891230, 3.5952340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 18
('SPKLU Thamrin Plaza Medan',
 'SPKLU', 'Starvo', 'Starvo EV',
 'Jl. Thamrin No.75, Gg. Buntu, Medan Timur',
 'KOTA MEDAN', 3.5978560000, 98.6831230000,
 ST_SetSRID(ST_MakePoint(98.6831230, 3.5978560), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 19
('SPKLU Tasbi Residence Medan',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Setia Budi Blok H No.1, Tanjung Rejo, Medan Sunggal',
 'KOTA MEDAN', 3.5734560000, 98.6412340000,
 ST_SetSRID(ST_MakePoint(98.6412340, 3.5734560), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 20
('SPKLU SPBU Pertamina Jl. Gatot Subroto',
 'SPKLU', 'PT Pertamina (Persero)', 'MyPertamina',
 'Jl. Gatot Subroto No.220, Sei Sikambing C II, Medan Helvetia',
 'KOTA MEDAN', 3.5945670000, 98.6398760000,
 ST_SetSRID(ST_MakePoint(98.6398760, 3.5945670), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 21
('SPKLU Luminor Hotel Medan',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Perintis Kemerdekaan No.17, Gaharu, Medan Timur',
 'KOTA MEDAN', 3.5812340000, 98.6889230000,
 ST_SetSRID(ST_MakePoint(98.6889230, 3.5812340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 22
('SPKLU Aryaduta Hotel Medan',
 'SPKLU', 'Starvo', 'Starvo EV',
 'Jl. Kapten Maulana Lubis No.6, Petisah Hulu, Medan Petisah',
 'KOTA MEDAN', 3.5867230000, 98.6712450000,
 ST_SetSRID(ST_MakePoint(98.6712450, 3.5867230), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 23
('SPKLU Medan Walk Lifestyle Mall',
 'SPKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Balai Kota No.1, Kesawan, Medan Barat',
 'KOTA MEDAN', 3.5891230000, 98.6756780000,
 ST_SetSRID(ST_MakePoint(98.6756780, 3.5891230), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg'),

-- 24
('SPKLU Bandara Kualanamu (KNIA)',
 'SPKLU', 'PT Angkasa Pura II', 'PLN Mobile',
 'Bandar Udara Internasional Kualanamu, Kuala Namu, Deli Serdang',
 'KOTA MEDAN', 3.6416780000, 98.8876230000,
 ST_SetSRID(ST_MakePoint(98.8876230, 3.6416780), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spklu_default.jpg');

-- ============================================================
-- INSERT DATA: SPBKLU di Kota Medan (30 stasiun dengan koordinat)
-- ============================================================

INSERT INTO stasiun (nama, jenis, badan_usaha, provider, alamat, kota, latitude, longitude, geom, status, created_by, foto_stasiun_url) VALUES

-- 1
('SPBKLU Alfamart Jl. Gatot Subroto',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Gatot Subroto No.100, Sei Sikambing B, Medan Sunggal',
 'KOTA MEDAN', 3.5849120000, 98.6501230000,
 ST_SetSRID(ST_MakePoint(98.6501230, 3.5849120), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 2
('SPBKLU Alfamart Jl. Setia Budi',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Setia Budi No.88, Tanjung Rejo, Medan Sunggal',
 'KOTA MEDAN', 3.5753450000, 98.6432110000,
 ST_SetSRID(ST_MakePoint(98.6432110, 3.5753450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 3
('SPBKLU Alfamart Jl. Pancing',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Pancing No.45, Sidorejo, Medan Tembung',
 'KOTA MEDAN', 3.6012340000, 98.7201230000,
 ST_SetSRID(ST_MakePoint(98.7201230, 3.6012340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 4
('SPBKLU Alfamart Jl. Sisingamangaraja',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Sisingamangaraja No.200, Teladan Timur, Medan Kota',
 'KOTA MEDAN', 3.5689340000, 98.6812340000,
 ST_SetSRID(ST_MakePoint(98.6812340, 3.5689340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 5
('SPBKLU Alfamart Jl. Ringroad',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Ring Road No.56, Pondok Surya, Medan Helvetia',
 'KOTA MEDAN', 3.6123450000, 98.6378900000,
 ST_SetSRID(ST_MakePoint(98.6378900, 3.6123450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 6
('SPBKLU Maju Bersama Jl. Sudirman',
 'SPBKLU', 'CV Maju Bersama', 'Swap Lokal',
 'Jl. Jend. Sudirman No.45, Sei Rengas II, Medan Kota',
 'KOTA MEDAN', 3.5812340000, 98.6789230000,
 ST_SetSRID(ST_MakePoint(98.6789230, 3.5812340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 7
('SPBKLU Maju Bersama Jl. Imam Bonjol',
 'SPBKLU', 'CV Maju Bersama', 'Swap Lokal',
 'Jl. Imam Bonjol No.12, Petisah Hulu, Medan Petisah',
 'KOTA MEDAN', 3.5856780000, 98.6645670000,
 ST_SetSRID(ST_MakePoint(98.6645670, 3.5856780), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 8
('SPBKLU Maju Bersama Jl. Gagak Hitam',
 'SPBKLU', 'CV Maju Bersama', 'Swap Lokal',
 'Jl. Gagak Hitam No.33, Helvetia Timur, Medan Helvetia',
 'KOTA MEDAN', 3.6023450000, 98.6334560000,
 ST_SetSRID(ST_MakePoint(98.6334560, 3.6023450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 9
('SPBKLU Indomaret Jl. Adam Malik',
 'SPBKLU', 'PT Indomarco Prismatama', 'Gesits Swap',
 'Jl. Adam Malik No.8, Hamdan, Medan Barat',
 'KOTA MEDAN', 3.5923450000, 98.6723450000,
 ST_SetSRID(ST_MakePoint(98.6723450, 3.5923450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 10
('SPBKLU Indomaret Jl. Jamin Ginting',
 'SPBKLU', 'PT Indomarco Prismatama', 'Gesits Swap',
 'Jl. Jamin Ginting No.100, Padang Bulan, Medan Baru',
 'KOTA MEDAN', 3.5689120000, 98.6534560000,
 ST_SetSRID(ST_MakePoint(98.6534560, 3.5689120), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 11
('SPBKLU Indomaret Jl. Iskandar Muda',
 'SPBKLU', 'PT Indomarco Prismatama', 'Gesits Swap',
 'Jl. Iskandar Muda No.50, Petisah Hulu, Medan Petisah',
 'KOTA MEDAN', 3.5867890000, 98.6578900000,
 ST_SetSRID(ST_MakePoint(98.6578900, 3.5867890), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 12
('SPBKLU Indomaret Jl. Nibung Raya',
 'SPBKLU', 'PT Indomarco Prismatama', 'Gesits Swap',
 'Jl. Nibung Raya No.77, Sei Putih Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5934560000, 98.6523450000,
 ST_SetSRID(ST_MakePoint(98.6523450, 3.5934560), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 13
('SPBKLU Kantor PLN UP3 Medan',
 'SPBKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Listrik No.8, Petisah Tengah, Medan Petisah',
 'KOTA MEDAN', 3.5912000000, 98.6623000000,
 ST_SetSRID(ST_MakePoint(98.6623000, 3.5912000), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 14
('SPBKLU Kantor PLN Medan Selatan',
 'SPBKLU', 'PT PLN (Persero)', 'PLN Mobile',
 'Jl. Juanda No.13, Teladan Barat, Medan Kota',
 'KOTA MEDAN', 3.5756780000, 98.6756780000,
 ST_SetSRID(ST_MakePoint(98.6756780, 3.5756780), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 15
('SPBKLU Pasar Sei Kambing',
 'SPBKLU', 'Pemkot Medan', 'Swap Lokal',
 'Jl. Gatot Subroto No.1, Sei Kambing B, Medan Sunggal',
 'KOTA MEDAN', 3.5878900000, 98.6434560000,
 ST_SetSRID(ST_MakePoint(98.6434560, 3.5878900), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 16
('SPBKLU Terminal Amplas',
 'SPBKLU', 'PT Damri', 'Gesits Swap',
 'Jl. Sisingamangaraja Km.10, Amplas, Medan Amplas',
 'KOTA MEDAN', 3.5423450000, 98.7112340000,
 ST_SetSRID(ST_MakePoint(98.7112340, 3.5423450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 17
('SPBKLU Terminal Pinang Baris',
 'SPBKLU', 'PT Damri', 'Gesits Swap',
 'Jl. Pinang Baris, Lalang, Medan Sunggal',
 'KOTA MEDAN', 3.6198760000, 98.6287650000,
 ST_SetSRID(ST_MakePoint(98.6287650, 3.6198760), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 18
('SPBKLU RS Adam Malik Medan',
 'SPBKLU', 'RSUP Adam Malik', 'PLN Mobile',
 'Jl. Bunga Lau No.17, Kemenangan Tani, Medan Tuntungan',
 'KOTA MEDAN', 3.5623450000, 98.6312340000,
 ST_SetSRID(ST_MakePoint(98.6312340, 3.5623450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 19
('SPBKLU Universitas Sumatera Utara',
 'SPBKLU', 'USU', 'PLN Mobile',
 'Jl. Dr. Mansur No.9, Padang Bulan, Medan Baru',
 'KOTA MEDAN', 3.5656780000, 98.6489230000,
 ST_SetSRID(ST_MakePoint(98.6489230, 3.5656780), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 20
('SPBKLU Politeknik Negeri Medan',
 'SPBKLU', 'POLMED', 'PLN Mobile',
 'Jl. Almamater No.1, Padang Bulan, Medan Baru',
 'KOTA MEDAN', 3.5634560000, 98.6501230000,
 ST_SetSRID(ST_MakePoint(98.6501230, 3.5634560), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 21
('SPBKLU Alfamart Jl. Brigjend Katamso',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Brigjend Katamso No.66, Kampung Baru, Medan Maimun',
 'KOTA MEDAN', 3.5789120000, 98.6867890000,
 ST_SetSRID(ST_MakePoint(98.6867890, 3.5789120), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 22
('SPBKLU Alfamart Jl. Aksara',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Aksara No.15, Sidorame Barat I, Medan Perjuangan',
 'KOTA MEDAN', 3.5901230000, 98.7012340000,
 ST_SetSRID(ST_MakePoint(98.7012340, 3.5901230), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 23
('SPBKLU Maju Bersama Jl. Helvetia',
 'SPBKLU', 'CV Maju Bersama', 'Swap Lokal',
 'Jl. Helvetia Raya No.5, Helvetia, Medan Helvetia',
 'KOTA MEDAN', 3.6089230000, 98.6289230000,
 ST_SetSRID(ST_MakePoint(98.6289230, 3.6089230), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 24
('SPBKLU Indomaret Jl. Letjend Suprapto',
 'SPBKLU', 'PT Indomarco Prismatama', 'Gesits Swap',
 'Jl. Letjend Suprapto No.24, Hamdan, Medan Barat',
 'KOTA MEDAN', 3.5834560000, 98.6712340000,
 ST_SetSRID(ST_MakePoint(98.6712340, 3.5834560), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 25
('SPBKLU Indomaret Jl. Helvetia Tengah',
 'SPBKLU', 'PT Indomarco Prismatama', 'Gesits Swap',
 'Jl. Helvetia Tengah No.89, Helvetia Tengah, Medan Helvetia',
 'KOTA MEDAN', 3.6056780000, 98.6312340000,
 ST_SetSRID(ST_MakePoint(98.6312340, 3.6056780), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 26
('SPBKLU Pasar Timah Medan',
 'SPBKLU', 'Pemkot Medan', 'Swap Lokal',
 'Jl. Sutomo No.1, Gang Buntu, Medan Timur',
 'KOTA MEDAN', 3.5978900000, 98.6923450000,
 ST_SetSRID(ST_MakePoint(98.6923450, 3.5978900), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 27
('SPBKLU Pasar Kocing Medan Helvetia',
 'SPBKLU', 'Pemkot Medan', 'Swap Lokal',
 'Jl. Kapten Sumarsono No.1, Helvetia Timur, Medan Helvetia',
 'KOTA MEDAN', 3.6145670000, 98.6345670000,
 ST_SetSRID(ST_MakePoint(98.6345670, 3.6145670), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 28
('SPBKLU Kompleks Cemara Asri',
 'SPBKLU', 'Developer Cemara', 'Swap Lokal',
 'Jl. Cemara No.1, Sampali, Medan Tembung',
 'KOTA MEDAN', 3.6234560000, 98.7145670000,
 ST_SetSRID(ST_MakePoint(98.7145670, 3.6234560), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 29
('SPBKLU Alfamart Jl. Williem Iskandar',
 'SPBKLU', 'PT Sumber Alfaria Trijaya Tbk', 'Gesits Swap',
 'Jl. Williem Iskandar No.55, Sidorejo Hilir, Medan Tembung',
 'KOTA MEDAN', 3.5812340000, 98.7289230000,
 ST_SetSRID(ST_MakePoint(98.7289230, 3.5812340), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg'),

-- 30
('SPBKLU Maju Bersama Jl. Tembung',
 'SPBKLU', 'CV Maju Bersama', 'Swap Lokal',
 'Jl. Tembung No.22, Tembung, Medan Tembung',
 'KOTA MEDAN', 3.5923450000, 98.7323450000,
 ST_SetSRID(ST_MakePoint(98.7323450, 3.5923450), 4326),
 'Beroperasi', 1,
 'https://res.cloudinary.com/demo/image/upload/v1/spbklu_default.jpg');

-- ============================================================
-- INSERT DATA: unit_pengisian untuk beberapa SPKLU
-- ============================================================

-- Unit untuk SPKLU PLN Medan Baru (id=1)
INSERT INTO unit_pengisian (stasiun_id, nama_unit, nomor_identitas, tipe_charger, daya_min_kw, daya_max_kw, harga_per_kwh, biaya_layanan) VALUES
(1, 'Unit A - Fast Charger', 'PLN-MDB-001-A', 'Fast Charging', 22, 50, 'Rp 1.650', 'Gratis'),
(1, 'Unit B - Ultra Fast', 'PLN-MDB-001-B', 'Ultra Fast Charging', 50, 150, 'Rp 1.750', 'Gratis');

-- Port untuk unit 1 (Fast Charger)
INSERT INTO port (unit_id, jenis_port, status_port) VALUES
(1, 'CCS2', 'Tersedia'),
(1, 'CHAdeMO', 'Tersedia'),
(1, 'Type 2 AC', 'Digunakan');

-- Port untuk unit 2 (Ultra Fast)
INSERT INTO port (unit_id, jenis_port, status_port) VALUES
(2, 'CCS2', 'Tersedia'),
(2, 'GB/T DC', 'Tersedia');

-- Unit untuk SPKLU Sun Plaza (id=2)
INSERT INTO unit_pengisian (stasiun_id, nama_unit, nomor_identitas, tipe_charger, daya_min_kw, daya_max_kw, harga_per_kwh, biaya_layanan) VALUES
(2, 'Unit 1 - Medium', 'PTM-SP-001', 'Medium Charging', 7, 22, 'Rp 1.600', 'Rp 2.000/sesi'),
(2, 'Unit 2 - Fast', 'PTM-SP-002', 'Fast Charging', 22, 50, 'Rp 1.650', 'Rp 2.000/sesi');

-- Port untuk unit 3 (Medium)
INSERT INTO port (unit_id, jenis_port, status_port) VALUES
(3, 'Type 2 AC', 'Tersedia'),
(3, 'Type 1 AC', 'Tersedia');

-- Port untuk unit 4 (Fast)
INSERT INTO port (unit_id, jenis_port, status_port) VALUES
(4, 'CCS2', 'Tersedia'),
(4, 'CHAdeMO', 'Tersedia');

-- Unit untuk SPKLU Cambridge (id=4)
INSERT INTO unit_pengisian (stasiun_id, nama_unit, nomor_identitas, tipe_charger, daya_min_kw, daya_max_kw, harga_per_kwh, biaya_layanan) VALUES
(4, 'Unit A', 'PLN-CAM-001', 'Fast Charging', 25, 50, 'Rp 1.650', 'Gratis'),
(4, 'Unit B', 'PLN-CAM-002', 'Slow Charging', 3, 7, 'Rp 1.550', 'Gratis');

INSERT INTO port (unit_id, jenis_port, status_port) VALUES
(5, 'CCS2', 'Tersedia'),
(5, 'CHAdeMO', 'Tersedia'),
(6, 'Type 2 AC', 'Tersedia');

-- ============================================================
-- INSERT DATA: kabinet_swap dan baterai untuk beberapa SPBKLU
-- ============================================================

-- Kabinet untuk SPBKLU Alfamart Gatot Subroto (id=25, first SPBKLU)
INSERT INTO kabinet_swap (stasiun_id, nama_kabinet, kapasitas_baterai, harga_penukaran) VALUES
(25, 'Kabinet A', 8, 'Rp 10.000/swap'),
(25, 'Kabinet B', 8, 'Rp 10.000/swap');

-- Baterai dalam kabinet 1
INSERT INTO baterai_swap (kabinet_id, kapasitas_ah, level_persen, jenis_sel, ketersediaan) VALUES
(1, '48Ah', 100, 'LiFePO4', 'Tersedia'),
(1, '48Ah', 95, 'LiFePO4', 'Tersedia'),
(1, '48Ah', 80, 'LiFePO4', 'Tersedia'),
(1, '48Ah', 0, 'LiFePO4', 'Sedang Digunakan'),
(1, '48Ah', 100, 'LiFePO4', 'Tersedia'),
(1, '48Ah', 75, 'LiFePO4', 'Tersedia'),
(1, '48Ah', 90, 'LiFePO4', 'Tersedia'),
(1, '48Ah', 0, 'LiFePO4', 'Sedang Digunakan');

-- Kabinet untuk SPBKLU PLN UP3 Medan (id=37, stasiun_id ke-13 SPBKLU)
INSERT INTO kabinet_swap (stasiun_id, nama_kabinet, kapasitas_baterai, harga_penukaran) VALUES
(37, 'Kabinet Utama', 12, 'Rp 8.000/swap');

INSERT INTO baterai_swap (kabinet_id, kapasitas_ah, level_persen, jenis_sel, ketersediaan) VALUES
(3, '60Ah', 100, 'Li-ion', 'Tersedia'),
(3, '60Ah', 88, 'Li-ion', 'Tersedia'),
(3, '60Ah', 95, 'Li-ion', 'Tersedia'),
(3, '60Ah', 70, 'Li-ion', 'Tersedia'),
(3, '60Ah', 0, 'Li-ion', 'Sedang Digunakan'),
(3, '60Ah', 100, 'Li-ion', 'Tersedia');

-- ============================================================
-- INSERT DATA: Kecamatan Medan (19 kecamatan)
-- Geometri polygon disederhanakan (bounding box per kecamatan)
-- Untuk produksi gunakan data GeoJSON dari BPS atau OpenStreetMap
-- ============================================================

INSERT INTO kecamatan (nama_kecamatan, geom) VALUES
('Medan Kota',      ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.665 3.560, 98.690 3.560, 98.690 3.580, 98.665 3.580, 98.665 3.560)')), 4326)),
('Medan Maimun',    ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.670 3.572, 98.690 3.572, 98.690 3.590, 98.670 3.590, 98.670 3.572)')), 4326)),
('Medan Polonia',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.655 3.562, 98.675 3.562, 98.675 3.582, 98.655 3.582, 98.655 3.562)')), 4326)),
('Medan Baru',      ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.645 3.575, 98.670 3.575, 98.670 3.600, 98.645 3.600, 98.645 3.575)')), 4326)),
('Medan Selayang',  ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.620 3.548, 98.655 3.548, 98.655 3.580, 98.620 3.580, 98.620 3.548)')), 4326)),
('Medan Tuntungan', ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.610 3.545, 98.645 3.545, 98.645 3.575, 98.610 3.575, 98.610 3.545)')), 4326)),
('Medan Johor',     ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.650 3.545, 98.685 3.545, 98.685 3.570, 98.650 3.570, 98.650 3.545)')), 4326)),
('Medan Amplas',    ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.695 3.535, 98.730 3.535, 98.730 3.565, 98.695 3.565, 98.695 3.535)')), 4326)),
('Medan Denai',     ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.685 3.560, 98.715 3.560, 98.715 3.582, 98.685 3.582, 98.685 3.560)')), 4326)),
('Medan Area',      ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.675 3.567, 98.698 3.567, 98.698 3.588, 98.675 3.588, 98.675 3.567)')), 4326)),
('Medan Kota',      ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.662 3.577, 98.688 3.577, 98.688 3.595, 98.662 3.595, 98.662 3.577)')), 4326)),
('Medan Petisah',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.645 3.582, 98.675 3.582, 98.675 3.605, 98.645 3.605, 98.645 3.582)')), 4326)),
('Medan Barat',     ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.660 3.580, 98.680 3.580, 98.680 3.600, 98.660 3.600, 98.660 3.580)')), 4326)),
('Medan Helvetia',  ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.620 3.590, 98.655 3.590, 98.655 3.625, 98.620 3.625, 98.620 3.590)')), 4326)),
('Medan Sunggal',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.628 3.572, 98.660 3.572, 98.660 3.602, 98.628 3.602, 98.628 3.572)')), 4326)),
('Medan Marelan',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.625 3.605, 98.670 3.605, 98.670 3.645, 98.625 3.645, 98.625 3.605)')), 4326)),
('Medan Belawan',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.660 3.645, 98.705 3.645, 98.705 3.690, 98.660 3.690, 98.660 3.645)')), 4326)),
('Medan Deli',      ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.680 3.605, 98.720 3.605, 98.720 3.645, 98.680 3.645, 98.680 3.605)')), 4326)),
('Medan Tembung',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.705 3.575, 98.740 3.575, 98.740 3.610, 98.705 3.610, 98.705 3.575)')), 4326)),
('Medan Timur',     ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.678 3.588, 98.710 3.588, 98.710 3.615, 98.678 3.615, 98.678 3.588)')), 4326)),
('Medan Perjuangan',ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.688 3.580, 98.715 3.580, 98.715 3.600, 98.688 3.600, 98.688 3.580)')), 4326)),
('Medan Labuhan',   ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(98.710 3.620, 98.750 3.620, 98.750 3.660, 98.710 3.660, 98.710 3.620)')), 4326));

-- ============================================================
-- QUERY DEMO: Contoh Query PostGIS untuk Ujian
-- ============================================================

-- 1. INSERT titik baru (demonstrasi DML spasial)
/*
INSERT INTO stasiun (nama, jenis, latitude, longitude, geom, alamat, status)
VALUES (
  'SPKLU Demo', 'SPKLU',
  3.5900, 98.6700,
  ST_SetSRID(ST_MakePoint(98.6700, 3.5900), 4326),
  'Jl. Demo No.1, Medan', 'Beroperasi'
);
*/

-- 2. Nearest Neighbor: 5 stasiun terdekat dari titik tertentu
/*
SELECT nama, jenis, alamat,
  ROUND(ST_Distance(geom::geography,
    ST_SetSRID(ST_MakePoint(98.6700, 3.5900), 4326)::geography)::numeric, 2) AS jarak_meter
FROM stasiun
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(98.6700, 3.5900), 4326)
LIMIT 5;
*/

-- 3. Radius: stasiun dalam radius 1 km
/*
SELECT nama, jenis, alamat
FROM stasiun
WHERE ST_DWithin(
  geom::geography,
  ST_SetSRID(ST_MakePoint(98.6700, 3.5900), 4326)::geography,
  1000
);
*/

-- 4. Intersect: stasiun dalam kecamatan
/*
SELECT s.nama, s.jenis, k.nama_kecamatan
FROM stasiun s, kecamatan k
WHERE ST_Within(s.geom, k.geom)
ORDER BY k.nama_kecamatan, s.nama;
*/

-- 5. Luas kecamatan
/*
SELECT nama_kecamatan,
  ROUND(ST_Area(geom::geography)::numeric / 1000000, 4) AS luas_km2
FROM kecamatan
ORDER BY luas_km2 DESC;
*/

-- 6. Buffer 500m di sekitar stasiun
/*
SELECT nama, ST_AsGeoJSON(ST_Buffer(geom::geography, 500)) AS buffer_geojson
FROM stasiun WHERE id = 1;
*/

-- 7. EXPLAIN ANALYZE untuk membuktikan penggunaan spatial index
/*
EXPLAIN ANALYZE
SELECT * FROM stasiun
WHERE ST_DWithin(
  geom::geography,
  ST_SetSRID(ST_MakePoint(98.6700, 3.5900), 4326)::geography,
  1000
);
*/

-- Refresh materialized view
REFRESH MATERIALIZED VIEW mv_statistik_stasiun;

-- ============================================================
-- SELESAI: Part 1 - Database Setup
-- Lanjutkan ke Part 2: Backend Node.js + Express
-- ============================================================