// ============================================================
// Auth Controller: Google OAuth 2.0 + JWT
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt    = require('jsonwebtoken');
const { query } = require('../config/db');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ============================================================
// Helper: buat JWT
// ============================================================
const signToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// ============================================================
// POST /api/auth/google
// Body: { credential: <Google ID token dari frontend> }
// ============================================================
const googleLogin = async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Token Google tidak ditemukan.' });
    }

    // Verifikasi token Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();

    const { sub: google_id, email, name, picture: avatar_url } = payload;

    // Cek apakah user sudah ada
    let result = await query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [google_id, email]
    );

    let user;
    if (result.rows.length > 0) {
      // Update data Google terbaru
      user = result.rows[0];
      await query(
        `UPDATE users SET google_id=$1, name=$2, avatar_url=$3 WHERE id=$4`,
        [google_id, name, avatar_url, user.id]
      );
      user = { ...user, name, avatar_url };
    } else {
      // Buat user baru, role default 'user'
      const insertResult = await query(
        `INSERT INTO users (google_id, email, name, avatar_url, role)
         VALUES ($1, $2, $3, $4, 'user') RETURNING *`,
        [google_id, email, name, avatar_url]
      );
      user = insertResult.rows[0];
    }

    const token = signToken(user);

    return res.json({
      success: true,
      message: 'Login berhasil.',
      token,
      user: {
        id:         user.id,
        email:      user.email,
        name:       user.name,
        avatar_url: user.avatar_url,
        role:       user.role
      }
    });

  } catch (err) {
    next(err);
  }
};

// ============================================================
// GET /api/auth/me
// Header: Authorization: Bearer <token>
// ============================================================
const getMe = async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, name, avatar_url, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = { googleLogin, getMe };