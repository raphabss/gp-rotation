'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const DEFAULT_PASSWORD = 'Spin@123';

// Lista inicial de usuários (semeada no primeiro boot)
const SEED_SLS = [
  { username: 'daniel.pecora',    name: 'Daniel Pecora' },
  { username: 'samuel.oliveira',  name: 'Samuel Oliveira' },
  { username: 'talles.paz',       name: 'Talles Paz' },
  { username: 'fernando.moraes',  name: 'Fernando Moraes' },
  { username: 'jullia.bentson',   name: 'Jullia Bentson' },
  { username: 'mariana.lourenco', name: 'Mariana Lourenco' },
  { username: 'vanessa.munguba',  name: 'Vanessa Munguba' },
  { username: 'mauricio.ribeiro', name: 'Mauricio Ribeiro' },
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

function seed() {
  const now = new Date().toISOString();
  const users = [];

  // Admin
  users.push({
    username: 'admin',
    name: 'Administrador',
    role: 'admin',
    passwordHash: hash(DEFAULT_PASSWORD),
    mustChangePassword: true,
    blocked: false,
    createdAt: now,
  });

  // Shift Leaders
  for (const sl of SEED_SLS) {
    users.push({
      username: sl.username,
      name: sl.name,
      role: 'sl',
      passwordHash: hash(DEFAULT_PASSWORD),
      mustChangePassword: true,
      blocked: false,
      createdAt: now,
    });
  }

  saveUsers(users);
  console.log(`[AUTH] Semeados ${users.length} usuários (senha inicial: ${DEFAULT_PASSWORD}, troca obrigatória no 1º login)`);
  return users;
}

function loadUsers() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return seed();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('[AUTH] erro ao ler users.json:', err.message);
    return [];
  }
}

function saveUsers(users) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function findUser(username) {
  return loadUsers().find(u => u.username === username.toLowerCase().trim());
}

function permissionsFor(user) {
  return {
    canManageUsers: user.role === 'admin',
    canEditRotation: true, // admin e sl podem editar rotação
  };
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.passwordHash);
}

function publicUser(u) {
  return {
    username: u.username,
    name: u.name,
    role: u.role,
    blocked: u.blocked,
    mustChangePassword: u.mustChangePassword,
    permissions: permissionsFor(u),
    createdAt: u.createdAt,
  };
}

// ── Operações de gestão ────────────────────────────────────────────────────
function setPassword(username, newPassword, { clearMustChange = true } = {}) {
  const users = loadUsers();
  const u = users.find(x => x.username === username);
  if (!u) throw new Error('Usuário não encontrado');
  u.passwordHash = hash(newPassword);
  if (clearMustChange) u.mustChangePassword = false;
  saveUsers(users);
  return publicUser(u);
}

function resetPassword(username) {
  const users = loadUsers();
  const u = users.find(x => x.username === username);
  if (!u) throw new Error('Usuário não encontrado');
  u.passwordHash = hash(DEFAULT_PASSWORD);
  u.mustChangePassword = true;
  saveUsers(users);
  return publicUser(u);
}

function createUser({ username, name, role }) {
  const users = loadUsers();
  username = username.toLowerCase().trim();
  if (users.some(u => u.username === username)) throw new Error('Usuário já existe');
  const u = {
    username, name, role: role === 'admin' ? 'admin' : 'sl',
    passwordHash: hash(DEFAULT_PASSWORD),
    mustChangePassword: true, blocked: false,
    createdAt: new Date().toISOString(),
  };
  users.push(u);
  saveUsers(users);
  return publicUser(u);
}

function updateUser(username, { name, role, blocked }) {
  const users = loadUsers();
  const u = users.find(x => x.username === username);
  if (!u) throw new Error('Usuário não encontrado');
  if (name !== undefined) u.name = name;
  if (role !== undefined) u.role = role === 'admin' ? 'admin' : 'sl';
  if (blocked !== undefined) u.blocked = !!blocked;
  saveUsers(users);
  return publicUser(u);
}

function deleteUser(username) {
  let users = loadUsers();
  if (username === 'admin') throw new Error('Não é possível remover o admin principal');
  const before = users.length;
  users = users.filter(u => u.username !== username);
  if (users.length === before) throw new Error('Usuário não encontrado');
  saveUsers(users);
  return { deleted: username };
}

module.exports = {
  loadUsers, findUser, verifyPassword, permissionsFor, publicUser,
  setPassword, resetPassword, createUser, updateUser, deleteUser,
  DEFAULT_PASSWORD,
};
