// ============================================================
// Stasiun Controller — CRUD + Query PostGIS
// Hikmal Akbar | 2305181024
// ============================================================

const { query } = require('../config/db');
const { deleteFromCloudinary } = require('../config/cloudinary');

// ============================================================
// GET /api/stasiun
// Query params: jenis, status, tipe_charger, daya_min, daya_max, page, limit
// Kembalikan GeoJSON FeatureCollection
// ============================================================
const getAllStasiun = async (req, res, next) => {
  try {
    const { jenis, status, tipe_charger, daya_min, daya_max, page = 1, limit = 200 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const params  = [];
    const filters = [];

    if (jenis)   { params.push(jenis.toUpperCase());  filters.push(`s.jenis = $${params.length}`); }
    if (status)  { params.push(status);               filters.push(`s.status = $${params.length}`); }

    // Filter berdasarkan tipe_charger atau daya via JOIN ke unit_pengisian
    let joinClause = '';
    if (tipe_charger || daya_min || daya_max) {
      joinClause = 'LEFT JOIN unit_pengisian u ON u.stasiun_id = s.id';
      if (tipe_charger) { params.push(`%${tipe_charger}%`); filters.push(`u.tipe_charger ILIKE $${params.length}`); }
      if (daya_min)     { params.push(parseInt(daya_min));  filters.push(`u.daya_max_kw >= $${params.length}`); }
      if (daya_max)     { params.push(parseInt(daya_max));  filters.push(`u.daya_min_kw <= $${params.length}`); }
    }

    const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

    params.push(parseInt(limit));
    params.push(offset);

    const sql = `
      SELECT
        s.id, s.nama, s.jenis, s.badan_usaha, s.provider,
        s.alamat, s.kota, s.latitude, s.longitude,
        s.status, s.foto_stasiun_url, s.created_at,
        ST_AsGeoJSON(s.geom)::json AS geometry
      FROM stasiun s
      ${joinClause}
      ${whereClause}
      ORDER BY s.id
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await query(sql, params);

    // Hitung total untuk pagination
    const countParams  = params.slice(0, -2);
    const countResult  = await query(
      `SELECT COUNT(DISTINCT s.id) FROM stasiun s ${joinClause} ${whereClause}`,
      countParams
    );
    const total = parseInt(countResult.rows[0].count);

    // Format sebagai GeoJSON FeatureCollection
    const features = result.rows.map(row => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        id:              row.id,
        nama:            row.nama,
        jenis:           row.jenis,
        badan_usaha:     row.badan_usaha,
        provider:        row.provider,
        alamat:          row.alamat,
        kota:            row.kota,
        latitude:        row.latitude,
        longitude:       row.longitude,
        status:          row.status,
        foto_stasiun_url:row.foto_stasiun_url,
        created_at:      row.created_at
      }
    }));

    res.json({
      success: true,
      type: 'FeatureCollection',
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      features
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/stasiun/:id
// Detail lengkap: stasiun + unit + port + kabinet + baterai
// ============================================================
const getStasiunById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Data stasiun utama
    const stasiunResult = await query(
      `SELECT s.*, u.name AS created_by_name, u.avatar_url AS created_by_avatar,
              ST_AsGeoJSON(s.geom)::json AS geometry
       FROM stasiun s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = $1`,
      [id]
    );
    if (!stasiunResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Stasiun tidak ditemukan.' });
    }
    const stasiun = stasiunResult.rows[0];

    // Unit pengisian + port (untuk SPKLU)
    const unitResult = await query(
      `SELECT up.*, json_agg(json_build_object(
          'id', p.id, 'jenis_port', p.jenis_port, 'status_port', p.status_port
       ) ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS ports
       FROM unit_pengisian up
       LEFT JOIN port p ON p.unit_id = up.id
       WHERE up.stasiun_id = $1
       GROUP BY up.id
       ORDER BY up.id`,
      [id]
    );

    // Kabinet swap + baterai (untuk SPBKLU)
    const kabinetResult = await query(
      `SELECT ks.*, json_agg(json_build_object(
          'id', bs.id, 'kapasitas_ah', bs.kapasitas_ah,
          'level_persen', bs.level_persen, 'jenis_sel', bs.jenis_sel,
          'ketersediaan', bs.ketersediaan
       ) ORDER BY bs.id) FILTER (WHERE bs.id IS NOT NULL) AS baterai
       FROM kabinet_swap ks
       LEFT JOIN baterai_swap bs ON bs.kabinet_id = ks.id
       WHERE ks.stasiun_id = $1
       GROUP BY ks.id
       ORDER BY ks.id`,
      [id]
    );

    // Kecamatan tempat stasiun berada
    const kecamatanResult = await query(
      `SELECT k.nama_kecamatan
       FROM kecamatan k
       WHERE ST_Within($1::geometry, k.geom)
       LIMIT 1`,
      [`SRID=4326;POINT(${stasiun.longitude} ${stasiun.latitude})`]
    );

    res.json({
      success: true,
      data: {
        ...stasiun,
        kecamatan: kecamatanResult.rows[0]?.nama_kecamatan || null,
        units:     unitResult.rows,
        kabinetSwap: kabinetResult.rows
      }
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/stasiun/nearby
// Query: ?lat=&lon=&limit=5&jenis=
// PostGIS: nearest neighbor dengan operator <->
// ============================================================
const getNearby = async (req, res, next) => {
  try {
    const { lat, lon, limit = 5, jenis } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ success: false, message: 'Parameter lat dan lon wajib diisi.' });
    }

    const params = [parseFloat(lon), parseFloat(lat), parseInt(limit)];
    const jenisFilter = jenis ? `AND s.jenis = $${params.length + 1}` : '';
    if (jenis) params.push(jenis.toUpperCase());

    // Query nearest neighbor menggunakan KNN dengan <-> operator
    // ST_Distance (geography) untuk jarak akurat dalam meter
    const sql = `
      SELECT
        s.id, s.nama, s.jenis, s.provider, s.alamat,
        s.latitude, s.longitude, s.status, s.foto_stasiun_url,
        ST_AsGeoJSON(s.geom)::json AS geometry,
        ROUND(
          ST_Distance(
            s.geom::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          )::numeric, 2
        ) AS jarak_meter
      FROM stasiun s
      WHERE s.status = 'Beroperasi' ${jenisFilter}
      ORDER BY s.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT $3
    `;

    const result = await query(sql, params);

    res.json({
      success: true,
      lokasi_pengguna: { lat: parseFloat(lat), lon: parseFloat(lon) },
      total: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/stasiun/within-radius
// Query: ?lat=&lon=&radius_m=1000&jenis=
// PostGIS: ST_DWithin (dalam radius meter)
// ============================================================
const getWithinRadius = async (req, res, next) => {
  try {
    const { lat, lon, radius_m = 1000, jenis } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ success: false, message: 'Parameter lat dan lon wajib diisi.' });
    }

    const radiusM  = Math.min(parseInt(radius_m), 50000); // maksimal 50 km
    const params   = [parseFloat(lon), parseFloat(lat), radiusM];
    const jenisFilter = jenis ? `AND s.jenis = $${params.length + 1}` : '';
    if (jenis) params.push(jenis.toUpperCase());

    // ST_DWithin dengan ::geography untuk jarak dalam meter
    const sql = `
      SELECT
        s.id, s.nama, s.jenis, s.provider, s.alamat,
        s.latitude, s.longitude, s.status, s.foto_stasiun_url,
        ST_AsGeoJSON(s.geom)::json AS geometry,
        ROUND(
          ST_Distance(
            s.geom::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          )::numeric, 2
        ) AS jarak_meter
      FROM stasiun s
      WHERE ST_DWithin(
        s.geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      ) ${jenisFilter}
      ORDER BY jarak_meter ASC
    `;

    const result = await query(sql, params);

    res.json({
      success: true,
      lokasi_pengguna: { lat: parseFloat(lat), lon: parseFloat(lon) },
      radius_meter: radiusM,
      total: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/stasiun/kecamatan/:nama
// Stasiun dalam batas kecamatan tertentu (ST_Within / ST_Intersects)
// ============================================================
const getByKecamatan = async (req, res, next) => {
  try {
    const { nama } = req.params;
    const sql = `
      SELECT s.id, s.nama, s.jenis, s.provider, s.alamat,
             s.latitude, s.longitude, s.status, s.foto_stasiun_url,
             ST_AsGeoJSON(s.geom)::json AS geometry,
             k.nama_kecamatan
      FROM stasiun s
      JOIN kecamatan k ON ST_Within(s.geom, k.geom)
      WHERE k.nama_kecamatan ILIKE $1
      ORDER BY s.nama
    `;
    const result = await query(sql, [`%${nama}%`]);
    res.json({ success: true, kecamatan: nama, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// POST /api/stasiun
// Tambah stasiun baru (user login) dengan PostGIS POINT
// Body: { nama, jenis, badan_usaha, provider, alamat, latitude, longitude,
//         status, foto_stasiun_url, units: [], kabinets: [] }
// ============================================================
const createStasiun = async (req, res, next) => {
  const client = (await require('../config/db').pool.connect());
  try {
    await client.query('BEGIN');

    const {
      nama, jenis, badan_usaha, provider, alamat,
      kota = 'KOTA MEDAN', latitude, longitude,
      status = 'Beroperasi', foto_stasiun_url,
      units = [], kabinets = []
    } = req.body;

    // Validasi input
    //if (!nama || !jenis || !latitude || !longitude) {
      //return res.status(400).json({ success: false, message: 'Nama, jenis, latitude, longitude wajib diisi.' });
    //}
    //if (!['SPKLU', 'SPBKLU'].includes(jenis.toUpperCase())) {
      //return res.status(400).json({ success: false, message: 'Jenis harus SPKLU atau SPBKLU.' });
    //}

    //const lat = parseFloat(latitude);
    //const lon = parseFloat(longitude);
    //if (isNaN(lat) || isNaN(lon)) {
      //return res.status(400).json({ success: false, message: 'Latitude dan longitude harus berupa angka.' });
    //}

    // Validasi input
    if (!nama || !jenis || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'Nama, jenis, latitude, longitude wajib diisi.' });
    }
    if (!['SPKLU', 'SPBKLU'].includes(jenis.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Jenis harus SPKLU atau SPBKLU.' });
    }

    // Konversi latitude/longitude dengan mengganti koma menjadi titik
    const latRaw = latitude.toString().replace(',', '.');
    const lonRaw = longitude.toString().replace(',', '.');
    const lat = parseFloat(latRaw);
    const lon = parseFloat(lonRaw);
    
    console.log('DEBUG createStasiun - latitude:', latitude, 'longitude:', longitude);
    console.log('DEBUG createStasiun - lat:', lat, 'lon:', lon);
    
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ success: false, message: 'Latitude dan longitude harus berupa angka yang valid.' });
    }

    console.log('typeof lat:', typeof lat, 'typeof lon:', typeof lon);
    console.log('lat value:', lat, 'lon value:', lon);

    // ✅ Query INSERT dengan ST_SetSRID(ST_MakePoint(...)) — demonstrasi DML Spasial
    const stasiunResult = await client.query(
      `INSERT INTO stasiun
        (nama, jenis, badan_usaha, provider, alamat, kota, latitude, longitude,
          geom, status, created_by, foto_stasiun_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
              ST_SetSRID(ST_MakePoint($9, $10), 4326),
              $11,$12,$13)
      RETURNING *`,
      [nama, jenis.toUpperCase(), badan_usaha, provider, alamat, kota,
      lat, lon,   // $7, $8 untuk kolom latitude/longitude
      lon, lat,   // $9, $10 untuk ST_MakePoint (urutan: longitude dulu, lalu latitude)
      status, req.user.id, foto_stasiun_url]  // $11, $12, $13
    );
    const newStasiun = stasiunResult.rows[0];

    // Insert unit pengisian (untuk SPKLU)
    for (const unit of units) {
      const unitResult = await client.query(
        `INSERT INTO unit_pengisian
           (stasiun_id, nama_unit, nomor_identitas, tipe_charger, daya_min_kw, daya_max_kw, harga_per_kwh, biaya_layanan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [newStasiun.id, unit.nama_unit, unit.nomor_identitas, unit.tipe_charger,
         unit.daya_min_kw, unit.daya_max_kw, unit.harga_per_kwh, unit.biaya_layanan]
      );
      const unitId = unitResult.rows[0].id;
      // Insert port per unit
      for (const p of (unit.ports || [])) {
        await client.query(
          `INSERT INTO port (unit_id, jenis_port, status_port) VALUES ($1,$2,$3)`,
          [unitId, p.jenis_port, p.status_port || 'Tersedia']
        );
      }
    }

    // Insert kabinet swap (untuk SPBKLU)
    for (const kab of kabinets) {
      const kabResult = await client.query(
        `INSERT INTO kabinet_swap (stasiun_id, nama_kabinet, kapasitas_baterai, harga_penukaran)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [newStasiun.id, kab.nama_kabinet, kab.kapasitas_baterai, kab.harga_penukaran]
      );
      const kabId = kabResult.rows[0].id;
      for (const bat of (kab.baterai || [])) {
        await client.query(
          `INSERT INTO baterai_swap (kabinet_id, kapasitas_ah, level_persen, jenis_sel, ketersediaan)
           VALUES ($1,$2,$3,$4,$5)`,
          [kabId, bat.kapasitas_ah, bat.level_persen || 100, bat.jenis_sel, bat.ketersediaan || 'Tersedia']
        );
      }
    }

    await client.query('COMMIT');

    // Refresh materialized view
    try { await query('REFRESH MATERIALIZED VIEW mv_statistik_stasiun'); } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Stasiun berhasil ditambahkan.',
      data: newStasiun
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ============================================================
// PUT /api/stasiun/:id
// Update stasiun (owner atau admin)
// ============================================================
const updateStasiun = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Cek keberadaan & kepemilikan
    const existing = await query('SELECT * FROM stasiun WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Stasiun tidak ditemukan.' });
    }
    const stasiun = existing.rows[0];
    if (req.user.role !== 'admin' && stasiun.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki izin mengubah stasiun ini.' });
    }

    const {
      nama, jenis, badan_usaha, provider, alamat, kota,
      latitude, longitude, status, foto_stasiun_url
    } = req.body;

    // Bangun query SET dinamis
    const fields = [];
    const values = [];
    let idx = 1;

    const add = (field, val) => { if (val !== undefined) { fields.push(`${field} = $${idx++}`); values.push(val); } };
    add('nama', nama); add('jenis', jenis ? jenis.toUpperCase() : undefined);
    add('badan_usaha', badan_usaha); add('provider', provider);
    add('alamat', alamat); add('kota', kota); add('status', status);
    add('foto_stasiun_url', foto_stasiun_url);

    // Update koordinat + geom jika latitude/longitude diubah
    if (latitude !== undefined && longitude !== undefined) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      fields.push(`latitude = $${idx++}`); values.push(lat);
      fields.push(`longitude = $${idx++}`); values.push(lon);
      // Tambahkan dua parameter baru untuk ST_MakePoint
      fields.push(`geom = ST_SetSRID(ST_MakePoint($${idx}::float, $${idx+1}::float), 4326)`);
      values.push(lon, lat);
      idx += 2;
    }

    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Tidak ada data yang diubah.' });
    }

    values.push(parseInt(id));
    const result = await query(
      `UPDATE stasiun SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({ success: true, message: 'Stasiun berhasil diperbarui.', data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// DELETE /api/stasiun/:id
// Hapus stasiun (owner atau admin) + hapus foto dari Cloudinary
// ============================================================
const deleteStasiun = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await query('SELECT * FROM stasiun WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Stasiun tidak ditemukan.' });
    }
    const stasiun = existing.rows[0];
    if (req.user.role !== 'admin' && stasiun.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki izin menghapus stasiun ini.' });
    }

    // Hapus foto dari Cloudinary
    if (stasiun.foto_stasiun_url) {
      await deleteFromCloudinary(stasiun.foto_stasiun_url);
    }

    // CASCADE sudah di-set di DB, cukup hapus stasiun
    await query('DELETE FROM stasiun WHERE id = $1', [id]);

    try { await query('REFRESH MATERIALIZED VIEW mv_statistik_stasiun'); } catch (_) {}

    res.json({ success: true, message: 'Stasiun berhasil dihapus.' });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/stasiun/milik-saya
// Stasiun yang di-upload oleh user yang sedang login
// ============================================================
const getMyStasiun = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, nama, jenis, alamat, status, foto_stasiun_url, created_at
       FROM stasiun WHERE created_by = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/stasiun/kecamatan-list
// Semua kecamatan dengan jumlah stasiun (dari VIEW)
// ============================================================
const getKecamatanList = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT k.id, k.nama_kecamatan,
              ST_AsGeoJSON(k.geom)::json AS geometry,
              COUNT(s.id) AS jumlah_stasiun,
              COUNT(s.id) FILTER (WHERE s.jenis='SPKLU')  AS jumlah_spklu,
              COUNT(s.id) FILTER (WHERE s.jenis='SPBKLU') AS jumlah_spbklu
       FROM kecamatan k
       LEFT JOIN stasiun s ON ST_Within(s.geom, k.geom)
       GROUP BY k.id, k.nama_kecamatan, k.geom
       ORDER BY jumlah_stasiun DESC`
    );
    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllStasiun, getStasiunById, getNearby, getWithinRadius,
  getByKecamatan, createStasiun, updateStasiun, deleteStasiun,
  getMyStasiun, getKecamatanList
};