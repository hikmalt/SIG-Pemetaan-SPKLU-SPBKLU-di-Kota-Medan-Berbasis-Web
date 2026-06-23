// ============================================================
// SIG EV Station Medan - Backend Server
// Mahasiswa: Hikmal Akbar | NIM: 2305181024
// Stack: Node.js + Express + PostgreSQL + PostGIS
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app = express();

// ============================================================
// MIDDLEWARE GLOBAL
// ============================================================

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS - izinkan frontend mengakses API
//app.use(cors({
  //origin: [
    //process.env.FRONTEND_URL || 'http://127.0.0.1:5500',
    //'http://localhost:5500',
    //'http://127.0.0.1:3000',
    //'http://localhost:3000'
  //],
  //methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  //allowedHeaders: ['Content-Type', 'Authorization'],
  //credentials: true
//}));

app.use(cors()); // tanpa parameter, izinkan semua origin

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - mencegah brute force / abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 300,                  // maksimal 300 request per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak request. Coba lagi nanti.' }
});
app.use('/api/', limiter);

// ============================================================
// IMPORT ROUTES
// ============================================================
const authRoutes    = require('./routes/auth.routes');
const stasiunRoutes = require('./routes/stasiun.routes');
const uploadRoutes  = require('./routes/upload.routes');
const reportRoutes  = require('./routes/report.routes');
const adminRoutes = require('./routes/admin.routes');

// ============================================================
// ROUTES
// ============================================================
app.use('/api/auth',    authRoutes);
app.use('/api/stasiun', stasiunRoutes);
app.use('/api/upload',  uploadRoutes);
app.use('/api/report',  reportRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SIG EV Station API berjalan',
    mahasiswa: { nama: 'Hikmal Akbar', nim: '2305181024' },
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} tidak ditemukan` });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Terjadi kesalahan server',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚗⚡ SIG EV Station Medan API`);
  console.log(`👤  Hikmal Akbar | NIM: 2305181024`);
  console.log(`🌐  Server: http://localhost:${PORT}`);
  console.log(`🗄️   DB   : ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  console.log(`🌱  Env  : ${process.env.NODE_ENV}\n`);
});

module.exports = app;