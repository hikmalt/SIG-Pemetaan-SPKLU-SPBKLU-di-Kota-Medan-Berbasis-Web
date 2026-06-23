// ============================================================
// FILE: routes/stasiun.routes.js
// Routes CRUD stasiun + query spasial PostGIS
// Hikmal Akbar | 2305181024
// PENTING: Urutan route penting!
//   /nearby, /within-radius, /user/milik-saya, /kecamatan-list
//   harus didaftarkan SEBELUM /:id agar tidak tertangkap sebagai ID
// ============================================================

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/stasiun.controller');
const {
  authenticate,
  optionalAuth,
  adminOnly
} = require('../middleware/auth.middleware');

// ── PROTECTED — harus di atas /:id ─────────────────────────
// GET stasiun milik user yang login (WAJIB di atas /:id!)
router.get('/user/milik-saya', authenticate, ctrl.getMyStasiun);

// ── PUBLIC / STATIC ROUTES (di atas /:id) ──────────────────
// GET daftar kecamatan + jumlah stasiun
router.get('/kecamatan-list', ctrl.getKecamatanList);

// GET nearest neighbor — ?lat=&lon=&limit=5&jenis=
// PostGIS: ORDER BY geom <-> point LIMIT N
router.get('/nearby', ctrl.getNearby);

// GET stasiun dalam radius — ?lat=&lon=&radius_m=1000&jenis=
// PostGIS: ST_DWithin(geom::geography, point::geography, radius)
router.get('/within-radius', ctrl.getWithinRadius);

// GET stasiun dalam kecamatan tertentu — /kecamatan/Medan Petisah
// PostGIS: ST_Within(s.geom, k.geom)
router.get('/kecamatan/:nama', ctrl.getByKecamatan);

// ── PUBLIC — semua stasiun (GeoJSON) ───────────────────────
// GET /api/stasiun?jenis=SPKLU&page=1&limit=200
router.get('/', optionalAuth, ctrl.getAllStasiun);

// ── DYNAMIC — harus di bawah semua route statis ────────────
// GET detail stasiun by ID
router.get('/:id', ctrl.getStasiunById);

// ── PROTECTED (login required) ──────────────────────────────
// POST tambah stasiun baru
router.post('/', authenticate, ctrl.createStasiun);

// PUT update stasiun (owner atau admin)
router.put('/:id', authenticate, ctrl.updateStasiun);

// DELETE hapus stasiun (owner atau admin)
router.delete('/:id', authenticate, ctrl.deleteStasiun);

module.exports = router;