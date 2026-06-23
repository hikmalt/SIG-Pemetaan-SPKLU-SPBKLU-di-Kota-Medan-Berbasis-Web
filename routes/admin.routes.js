// FILE: routes/admin.routes.js
const express = require('express');
const router = express.Router();
//const { getUsers } = require('../controllers/admin.controller');
const {
  getUsers,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/admin.controller');
const { authenticate, adminOnly } = require('../middleware/auth.middleware');

// GET /api/admin/users — hanya admin
router.get('/users', authenticate, adminOnly, getUsers);
router.post('/users', authenticate, adminOnly, createUser);
router.put('/users/:id', authenticate, adminOnly, updateUser);
router.delete('/users/:id', authenticate, adminOnly, deleteUser);

module.exports = router;