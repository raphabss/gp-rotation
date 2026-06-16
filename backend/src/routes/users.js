'use strict';

const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { requireAuth, requireAdmin } = require('../auth/jwt');

// Todas as rotas exigem admin
router.use(requireAuth, requireAdmin);

// GET /api/users
router.get('/', (req, res) => {
  res.json(users.loadUsers().map(users.publicUser));
});

// POST /api/users  { username, name, role }
router.post('/', (req, res) => {
  try {
    const u = users.createUser(req.body || {});
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/users/:username  { name?, role?, blocked? }
router.patch('/:username', (req, res) => {
  try {
    if (req.params.username === 'admin' && req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ error: 'Não é possível rebaixar o admin principal' });
    }
    const u = users.updateUser(req.params.username, req.body || {});
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/users/:username/reset  → reseta para senha padrão + troca obrigatória
router.post('/:username/reset', (req, res) => {
  try {
    const u = users.resetPassword(req.params.username);
    res.json({ success: true, user: u, tempPassword: users.DEFAULT_PASSWORD });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:username
router.delete('/:username', (req, res) => {
  try {
    res.json({ success: true, ...users.deleteUser(req.params.username) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
