'use strict';
// Stands in for the sign-in helpers when the take is of the local copy of the app: nothing to sign in to, nothing
// secret to redact.
module.exports = { redact: (s) => String(s) };
