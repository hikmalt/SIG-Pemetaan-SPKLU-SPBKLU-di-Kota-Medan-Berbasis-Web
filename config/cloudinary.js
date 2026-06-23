// ============================================================
// Konfigurasi Cloudinary untuk penyimpanan gambar stasiun
// ============================================================

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload buffer gambar ke Cloudinary
 * @param {Buffer} buffer - buffer gambar dari multer
 * @param {string} folder - folder tujuan di Cloudinary
 * @returns {Promise<string>} - secure_url gambar
 */
const uploadToCloudinary = (buffer, folder = 'sig-ev-medan/stasiun') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 800, height: 600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) return reject(new Error('Upload Cloudinary gagal: ' + error.message));
        resolve(result.secure_url);
      }
    );
    // Tulis buffer ke stream
    const streamifier = require('streamifier');
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

/**
 * Hapus gambar dari Cloudinary berdasarkan URL
 * @param {string} imageUrl - URL gambar Cloudinary
 */
const deleteFromCloudinary = async (imageUrl) => {
  try {
    if (!imageUrl || !imageUrl.includes('cloudinary')) return;
    // Ekstrak public_id dari URL
    const parts = imageUrl.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return;
    // Gabungkan folder + nama file tanpa ekstensi
    const publicIdWithExt = parts.slice(uploadIndex + 2).join('/');
    const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '');
    await cloudinary.uploader.destroy(publicId);
    console.log('🗑️  Gambar dihapus dari Cloudinary:', publicId);
  } catch (err) {
    console.error('⚠️  Gagal hapus Cloudinary:', err.message);
  }
};

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };