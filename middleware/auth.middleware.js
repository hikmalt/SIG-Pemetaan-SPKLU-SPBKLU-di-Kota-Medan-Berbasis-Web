// ============================================================
// Middleware Autentikasi JWT & Role Guard
// ============================================================

const jwt = require('jsonwebtoken');

/**
 * Verifikasi JWT dari header Authorization: Bearer <token>
 * Set req.user = { id, email, role, name }
 */
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role, name }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token kadaluarsa. Silakan login ulang.' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid.' });
  }
};

/**
 * Optional auth — tidak wajib login, tapi jika ada token di-set req.user
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }
  } catch (_) {}
  next();
};

/**
 * Guard: hanya admin yang boleh akses
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin yang diizinkan.' });
  }
  next();
};

module.exports = { authenticate, optionalAuth, adminOnly };