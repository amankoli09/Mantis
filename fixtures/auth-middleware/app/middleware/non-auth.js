'use strict';

// Non-auth middleware (request logger)
function requestLogger(req, res, next) {
  next();
}

module.exports = {
  requestLogger,
};
