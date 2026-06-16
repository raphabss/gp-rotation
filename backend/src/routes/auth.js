'use strict';

const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { signToken, requireAuth } = require('../auth/jwt');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha' });

  const user = users.findUser(username);
  if (!user || !users.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  if (user.blocked) return res.status(403).json({ error: 'Usuário bloqueado. Procure o administrador.' });

  const token = signToken(user);
  res.json({
    token,
    user: users.publicUser(user),
    mustChangePassword: user.mustChangePassword,
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json(users.publicUser(req.user));
});

// POST /api/auth/change-password  (próprio usuário)
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Nova senha deve ter ao menos 6 caracteres' });
  }
  // Se não é troca obrigatória, exige a senha atual
  if (!req.user.mustChangePassword) {
    if (!currentPassword || !users.verifyPassword(req.user, currentPassword)) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
  }
  // Impede repetir a senha padrão
  if (newPassword === users.DEFAULT_PASSWORD) {
    return res.status(400).json({ error: 'Escolha uma senha diferente da padrão' });
  }
  const updated = users.setPassword(req.user.username, newPassword, { clearMustChange: true });
  res.json({ success: true, user: updated });
});

module.exports = router;
