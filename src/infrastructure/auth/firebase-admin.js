const admin = require("firebase-admin");
const { env } = require("../../config/env");

let firebaseApp = null;

function getFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (!env.firebase.configured) {
    return null;
  }

  const appConfig = {
    projectId: env.firebase.projectId,
  };

  if (env.firebase.serviceAccountConfigured) {
    appConfig.credential = admin.credential.cert({
      projectId: env.firebase.projectId,
      clientEmail: env.firebase.clientEmail,
      privateKey: env.firebase.privateKey.replace(/\\n/g, "\n"),
    });
  }

  firebaseApp = admin.initializeApp(appConfig);

  return firebaseApp;
}

module.exports = { admin, getFirebaseApp };
