const express = require('express');
const userService = require('../services/userService');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = userService.findByEmail(email || '');
  if (!user || !user.active || !userService.verifyPassword(user, password || '')) {
    return res.status(401).render('login', { error: 'E-mail ou senha inválidos.' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { error: 'Erro ao entrar. Tente novamente.' });
    req.session.userId = user.id;
    const dest = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(dest);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.post('/minha-senha', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const { current_password, new_password, new_password_confirm } = req.body;
  if (!userService.verifyPassword(req.user, current_password || '')) {
    return res.status(400).render('profile', { error: 'Senha atual incorreta.', ok: null });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).render('profile', { error: 'A nova senha precisa ter ao menos 6 caracteres.', ok: null });
  }
  if (new_password !== new_password_confirm) {
    return res.status(400).render('profile', { error: 'A confirmação não confere com a nova senha.', ok: null });
  }
  userService.changePassword(req.user.id, new_password);
  res.render('profile', { error: null, ok: 'Senha alterada com sucesso.' });
});

router.get('/perfil', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('profile', { error: null, ok: null });
});

module.exports = router;
