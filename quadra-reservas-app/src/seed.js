// Script de inicializacao: cria a conta do sindico (admin) e, opcionalmente,
// moradores de demonstracao. Rode com `npm run seed`.
// A senha do sindico pode ser definida por variavel de ambiente ADMIN_PASSWORD;
// caso contrario uma senha aleatoria e gerada e impressa no terminal (nunca
// fica salva em texto puro em lugar nenhum, so exibida uma vez aqui).
require('dotenv').config();
const crypto = require('crypto');
const db = require('./db');
const userService = require('./services/userService');

function randomPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL || 'sindico@condominio.local';
  const existing = userService.findByEmail(email);
  if (existing) {
    console.log(`[seed] Síndico já existe: ${email}`);
    return;
  }
  const password = process.env.ADMIN_PASSWORD || randomPassword();
  userService.createUser({
    name: process.env.ADMIN_NAME || 'Síndico(a)',
    email,
    password,
    apartment: process.env.ADMIN_APARTMENT || 'Administração',
    role: 'sindico'
  });
  console.log('[seed] Conta do síndico criada:');
  console.log(`         e-mail: ${email}`);
  console.log(`         senha:  ${password}`);
  console.log('       Troque essa senha após o primeiro login.');
}

function ensureDemoResidents() {
  if (process.env.SEED_DEMO !== 'true') return;
  const demo = [
    { name: 'Ana Souza', email: 'ana@condominio.local', apartment: '101' },
    { name: 'Bruno Lima', email: 'bruno@condominio.local', apartment: '102' },
    { name: 'Carla Nunes', email: 'carla@condominio.local', apartment: '201' },
    { name: 'Diego Rocha', email: 'diego@condominio.local', apartment: '202' }
  ];
  for (const d of demo) {
    if (userService.findByEmail(d.email)) continue;
    userService.createUser({ ...d, password: 'moradia123', role: 'morador' });
    console.log(`[seed] Morador demo criado: ${d.email} / senha: moradia123`);
  }
}

ensureAdmin();
ensureDemoResidents();
db.close();
