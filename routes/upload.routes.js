// ============================================================
// FILE: routes/upload.routes.js
// Route upload gambar ke Cloudinary
// Hikmal Akbar | 2305181024
// ============================================================

const express = require('express');
const router  = express.Router();
const { uploadImage }              = require('../controllers/upload.controller');
const { authenticate }             = require('../middleware/auth.middleware');
const { upload, handleMulterError } = require('../middleware/upload.middleware');

// POST /api/upload
// Multipart: field name "foto"
// Butuh login (JWT)
// Mengembalikan: { success, url, originalname, size }
router.post(
  '/',
  authenticate,
  upload.single('foto'),
  handleMulterError,
  uploadImage
);

module.exports = router;