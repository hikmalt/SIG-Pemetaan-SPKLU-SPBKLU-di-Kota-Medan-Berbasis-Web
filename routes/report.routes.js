// ============================================================
// FILE: routes/report.routes.js
// Routes laporan & analisis spasial PostGIS
// Hikmal Akbar | 2305181024
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getAnalisis,
  getGeoJSONKecamatan,
  getBuffer,
  getFotoAcak,
  getExplainAnalyze
} = require('../controllers/report.controller');

// GET /api/report/analisis
// Statistik & analisis spasial lengkap (per kecamatan, provider, dll)
router.get('/analisis', getAnalisis);

// GET /api/report/geojson-kecamatan
// GeoJSON polygon kecamatan untuk layer Leaflet
router.get('/geojson-kecamatan', getGeoJSONKecamatan);

// GET /api/report/buffer?stasiun_id=1&radius_m=500
// Buffer area ST_Buffer — demonstrasi rubrik
router.get('/buffer', getBuffer);

// GET /api/report/foto-acak?limit=8
// Foto acak untuk carousel landing page
router.get('/foto-acak', getFotoAcak);

// GET /api/report/explain-analyze?lat=3.5952&lon=98.6722&radius_m=1000
// EXPLAIN ANALYZE untuk buktikan spatial index GIST
router.get('/explain-analyze', getExplainAnalyze);

module.exports = router;