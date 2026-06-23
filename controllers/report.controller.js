// ============================================================
// FILE: controllers/report.controller.js
//VERSI 1
// Report Controller — Analisis Spasial PostGIS
// Hikmal Akbar | 2305181024
// Endpoints: analisis, geojson-kecamatan, buffer, foto-acak
// ============================================================

const { query } = require('../config/db');

// ============================================================
// GET /api/report/analisis
// Statistik lengkap & analisis spasial untuk halaman laporan
// Mencakup: ST_Within, ST_Area, ST_Distance, aggregasi per kecamatan
// ============================================================
const getAnalisis = async (req, res, next) => {
  try {
    // 1. Statistik umum (dari materialized view atau query langsung)
    const statResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE jenis = 'SPKLU')           AS total_spklu,
        COUNT(*) FILTER (WHERE jenis = 'SPBKLU')          AS total_spbklu,
        COUNT(*)                                           AS total_semua,
        COUNT(*) FILTER (WHERE status = 'Beroperasi')     AS total_aktif,
        COUNT(*) FILTER (WHERE status != 'Beroperasi')    AS total_nonaktif
      FROM stasiun
    `);

    // 2. Jumlah stasiun per kecamatan — Query utama: ST_Within (intersect polygon)
    // Ini adalah demonstrasi query ANALISIS SPASIAL untuk rubrik penilaian
    const kecamatanResult = await query(`
      SELECT
        k.nama_kecamatan,
        COUNT(s.id)                                           AS jumlah_stasiun,
        COUNT(s.id) FILTER (WHERE s.jenis = 'SPKLU')         AS spklu,
        COUNT(s.id) FILTER (WHERE s.jenis = 'SPBKLU')        AS spbklu,
        ROUND(ST_Area(k.geom::geography)::numeric / 1000000, 3) AS luas_km2
      FROM kecamatan k
      LEFT JOIN stasiun s ON ST_Within(s.geom, k.geom)
      GROUP BY k.id, k.nama_kecamatan, k.geom
      ORDER BY jumlah_stasiun DESC
    `);

    // 3. Provider / badan usaha terbanyak
    const providerResult = await query(`
      SELECT badan_usaha, COUNT(*) AS jumlah
      FROM stasiun
      WHERE badan_usaha IS NOT NULL
        AND badan_usaha != ''
      GROUP BY badan_usaha
      ORDER BY jumlah DESC
      LIMIT 10
    `);

    // 4. Stasiun dengan daya terbesar (join ke unit_pengisian)
    const dayaResult = await query(`
      SELECT s.nama, s.jenis, s.alamat,
             MAX(u.daya_max_kw) AS daya_max_kw
      FROM stasiun s
      JOIN unit_pengisian u ON u.stasiun_id = s.id
      WHERE u.daya_max_kw IS NOT NULL
      GROUP BY s.id, s.nama, s.jenis, s.alamat
      ORDER BY daya_max_kw DESC
      LIMIT 5
    `);

    // 5. Distribusi tipe charger
    const chargerResult = await query(`
      SELECT tipe_charger, COUNT(*) AS jumlah
      FROM unit_pengisian
      WHERE tipe_charger IS NOT NULL
      GROUP BY tipe_charger
      ORDER BY jumlah DESC
    `);

    // 6. Luas per kecamatan — demonstrasi ST_Area
    const luasResult = await query(`
      SELECT nama_kecamatan,
             ROUND(ST_Area(geom::geography)::numeric / 1000000, 4) AS luas_km2
      FROM kecamatan
      ORDER BY luas_km2 DESC
    `);

    // 7. Stasiun terjauh dari pusat kota Medan (ST_Distance)
    // Referensi: Lapangan Merdeka Medan
    const pusatLon = 98.6722;
    const pusatLat = 3.5952;
    const terpencilResult = await query(`
      SELECT nama, jenis, alamat,
             ROUND(
               ST_Distance(
                 geom::geography,
                 ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
               )::numeric / 1000,
             2) AS jarak_dari_pusat_km
      FROM stasiun
      ORDER BY jarak_dari_pusat_km DESC
      LIMIT 5
    `, [pusatLon, pusatLat]);

    // 8. Stasiun yang baru ditambahkan (7 hari terakhir)
    const recentResult = await query(`
      SELECT id, nama, jenis, alamat, created_at
      FROM stasiun
      WHERE created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        statistik_umum:       statResult.rows[0],
        per_kecamatan:        kecamatanResult.rows,
        per_provider:         providerResult.rows,
        daya_tertinggi:       dayaResult.rows,
        distribusi_charger:   chargerResult.rows,
        luas_kecamatan:       luasResult.rows,
        terjauh_dari_pusat:   terpencilResult.rows,
        baru_ditambahkan:     recentResult.rows,
        pusat_kota_referensi: { lon: pusatLon, lat: pusatLat, nama: 'Lapangan Merdeka Medan' }
      }
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/report/geojson-kecamatan
// GeoJSON FeatureCollection semua polygon kecamatan
// Digunakan oleh Leaflet untuk menampilkan layer kecamatan
// ============================================================
const getGeoJSONKecamatan = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        k.id,
        k.nama_kecamatan,
        ST_AsGeoJSON(k.geom)::json AS geometry,
        COUNT(s.id)                                           AS jumlah_stasiun,
        COUNT(s.id) FILTER (WHERE s.jenis = 'SPKLU')         AS spklu,
        COUNT(s.id) FILTER (WHERE s.jenis = 'SPBKLU')        AS spbklu
      FROM kecamatan k
      LEFT JOIN stasiun s ON ST_Within(s.geom, k.geom)
      GROUP BY k.id, k.nama_kecamatan, k.geom
      ORDER BY k.nama_kecamatan
    `);

    const features = result.rows.map(row => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        id:             row.id,
        nama_kecamatan: row.nama_kecamatan,
        jumlah_stasiun: parseInt(row.jumlah_stasiun),
        spklu:          parseInt(row.spklu),
        spbklu:         parseInt(row.spbklu)
      }
    }));

    res.json({
      type: 'FeatureCollection',
      total: features.length,
      features
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/report/buffer?stasiun_id=1&radius_m=500
// Buffer area (ST_Buffer) sekitar stasiun tertentu
// Rubrik: demonstrasi query Buffer PostGIS
// ============================================================
const getBuffer = async (req, res, next) => {
  try {
    const { stasiun_id, radius_m = 500 } = req.query;
    if (!stasiun_id) {
      return res.status(400).json({
        success: false,
        message: 'Parameter stasiun_id wajib diisi.'
      });
    }

    const radius = Math.min(parseInt(radius_m), 10000); // maksimal 10 km

    // ST_Buffer: buat buffer dalam meter menggunakan ::geography
    // Kemudian konversi kembali ke SRID 4326 untuk GeoJSON
    const result = await query(`
      SELECT
        s.nama,
        s.jenis,
        s.latitude,
        s.longitude,
        s.alamat,
        ST_AsGeoJSON(
          ST_Transform(
            ST_Buffer(s.geom::geography::geometry, $2),
            4326
          )
        )::json AS buffer_geojson,
        (
          SELECT COUNT(*) FROM stasiun s2
          WHERE ST_DWithin(
            s2.geom::geography,
            s.geom::geography,
            $2
          ) AND s2.id != s.id
        ) AS stasiun_dalam_radius
      FROM stasiun s
      WHERE s.id = $1
    `, [parseInt(stasiun_id), radius]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Stasiun tidak ditemukan.'
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      stasiun:              row.nama,
      jenis:                row.jenis,
      lokasi:               { lat: row.latitude, lon: row.longitude, alamat: row.alamat },
      radius_meter:         radius,
      stasiun_dalam_radius: parseInt(row.stasiun_dalam_radius),
      buffer_geojson:       row.buffer_geojson
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/report/foto-acak?limit=8
// Ambil foto acak dari database untuk carousel di landing page
// Hanya stasiun yang memiliki foto selain URL demo/placeholder
// ============================================================
const getFotoAcak = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 8, 20);

    const result = await query(`
      SELECT id, nama, jenis, alamat, foto_stasiun_url
      FROM stasiun
      WHERE foto_stasiun_url IS NOT NULL
        AND foto_stasiun_url != ''
        AND foto_stasiun_url NOT LIKE '%/spklu_default%'
        AND foto_stasiun_url NOT LIKE '%/spbklu_default%'
      ORDER BY RANDOM()
      LIMIT $1
    `, [limit]);

    // Jika tidak ada foto asli, kembalikan semua stasiun dengan foto default
    if (result.rows.length === 0) {
      const fallback = await query(`
        SELECT id, nama, jenis, alamat, foto_stasiun_url
        FROM stasiun
        WHERE foto_stasiun_url IS NOT NULL
        ORDER BY RANDOM()
        LIMIT $1
      `, [limit]);
      return res.json({ success: true, data: fallback.rows });
    }

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/report/explain-analyze
// EXPLAIN ANALYZE untuk membuktikan penggunaan spatial index GIST
// Rubrik: demonstrasi optimasi index
// ============================================================
const getExplainAnalyze = async (req, res, next) => {
  try {
    const { lat = 3.5952, lon = 98.6722, radius_m = 1000 } = req.query;

    const explainResult = await query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM stasiun
      WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
    `, [parseFloat(lon), parseFloat(lat), parseInt(radius_m)]);

    const plan = explainResult.rows[0]['QUERY PLAN'];
    // Periksa apakah menggunakan Index Scan
    const planStr    = JSON.stringify(plan);
    const usesIndex  = planStr.includes('Index Scan') || planStr.includes('Bitmap Index');

    res.json({
      success:       true,
      uses_gist_index: usesIndex,
      index_name:    'idx_stasiun_geom',
      plan_summary:  usesIndex
        ? '✅ Index Scan menggunakan idx_stasiun_geom (GIST) — query optimal'
        : '⚠️ Tidak menggunakan index — cek apakah GIST index sudah dibuat',
      full_plan:     plan
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAnalisis,
  getGeoJSONKecamatan,
  getBuffer,
  getFotoAcak,
  getExplainAnalyze
};