require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const { attachUser, requireLogin, requireAdmin } = require('./src/auth');
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const interestRoutes = require('./src/routes/interest');
const adminRoutes = require('./src/routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  name: 'quadra.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
  }
}));

app.use(attachUser);

// rotas publicas (login)
app.use('/', authRoutes);

// tudo abaixo exige login
app.use(requireLogin);
app.use('/', dashboardRoutes);
app.use('/', interestRoutes);
app.use('/', requireAdmin, adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Página não encontrada', message: 'Essa página não existe.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Erro interno', message: 'Algo deu errado. Tente novamente.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Quadra Reservas rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
