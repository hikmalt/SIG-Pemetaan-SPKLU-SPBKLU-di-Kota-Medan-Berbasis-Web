// ============================================================
// FILE: routes/auth.routes.js
// Routes autentikasi Google OAuth + JWT
// Hikmal Akbar | 2305181024
// ============================================================

const express = require('express');
const router  = express.Router();
const { googleLogin, getMe } = require('../controllers/auth.controller');
const { authenticate }       = require('../middleware/auth.middleware');

// POST /api/auth/google — Login dengan Google credential
router.post('/google', googleLogin);

// GET /api/auth/me — Ambil profil user (butuh JWT)
router.get('/me', authenticate, getMe);

module.exports = router;