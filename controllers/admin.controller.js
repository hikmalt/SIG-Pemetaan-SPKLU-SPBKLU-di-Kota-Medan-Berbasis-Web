// FILE: controllers/admin.controller.js
const { query } = require('../config/db');

const getUsers = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, google_id, email, name, avatar_url, role, created_at
      FROM users
      ORDER BY created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// POST - tambah user manual (tanpa Google OAuth)
const createUser = async (req, res, next) => {
  const { email, name, role } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email wajib diisi' });
  const allowedRoles = ['admin', 'user'];
  if (role && !allowedRoles.includes(role)) return res.status(400).json({ success: false, message: 'Role tidak valid' });
  try {
    const exist = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (exist.rows.length) return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
    const result = await query(
      `INSERT INTO users (email, name, role, google_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, email, name, role, created_at`,
      [email, name || email.split('@')[0], role || 'user', null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// PUT - update user (name, role) - email TIDAK diubah
const updateUser = async (req, res, next) => {
  const { id } = req.params;
  const { name, role } = req.body;
  console.log('🔵 UPDATE USER - ID:', id, 'Name:', name, 'Role:', role);  // <-- tambahkan ini
  const allowedRoles = ['admin', 'user'];
  if (role && !allowedRoles.includes(role)) return res.status(400).json({ success: false, message: 'Role tidak valid' });
  try {
    const result = await query(
        `UPDATE users 
        SET name = $1, 
            role = $2
        WHERE id = $3
        RETURNING id, email, name, role, created_at`,
        [name, role, id]
        );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    console.log('✅ User updated:', result.rows[0]); // <-- tambahkan ini
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// DELETE - hapus user (hanya jika tidak memiliki stasiun)
const deleteUser = async (req, res, next) => {
  const { id } = req.params;
  try {
    const stasiunCount = await query('SELECT COUNT(*) FROM stasiun WHERE created_by = $1', [id]);
    if (parseInt(stasiunCount.rows[0].count) > 0) {
      return res.status(400).json({ success: false, message: 'User memiliki stasiun, tidak bisa dihapus. Hapus stasiunnya terlebih dahulu.' });
    }
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser };