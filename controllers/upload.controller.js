// ============================================================
// Upload Controller — Cloudinary
// POST /api/upload
// ============================================================

const { uploadToCloudinary } = require('../config/cloudinary');

const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File gambar tidak ditemukan.' });
    }

    const folder = req.body.folder || 'sig-ev-medan/stasiun';
    const url = await uploadToCloudinary(req.file.buffer, folder);

    res.json({
      success: true,
      message: 'Gambar berhasil diupload.',
      url,
      originalname: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadImage };