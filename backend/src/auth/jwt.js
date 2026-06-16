'use strict';

const jwt = require('jsonwebtoken');
const { findUser, permissionsFor } = require('./users');

const JWT_SECRET = process.env.JWT_SECRET || 'spin-gaming-gp-rotation-secret-change-me';
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign(
    { sub: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Middleware: exige token válido e usuário ativo
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  try {
    const payload = verifyToken(token);
    const user = findUser(payload.sub);
    if (!user) return res.status(401).json({ error: 'Usuário inválido' });
    if (user.blocked) return res.status(403).json({ error: 'Usuário bloqueado' });
    req.user = user;
    req.permissions = permissionsFor(user);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida' });
  }
}

// Middleware: exige papel admin
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administrador' });
  }
  next();
}

module.exports = { signToken, verifyToken, requireAuth, requireAdmin, TOKEN_TTL };
