const userService = require('./services/userService');

function attachUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = userService.findById(req.session.userId);
    if (user && user.active) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'sindico') {
    return res.status(403).render('error', { title: 'Acesso negado', message: 'Só o síndico pode acessar esta página.' });
  }
  next();
}

module.exports = { attachUser, requireLogin, requireAdmin };
