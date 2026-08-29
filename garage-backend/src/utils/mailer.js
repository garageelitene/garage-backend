const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
  });
}

/**
 * Envoie un email avec pièce jointe (utilisé pour l'envoi de facture PDF).
 * Si aucun SMTP n'est configuré (.env), la fonction échoue explicitement
 * plutôt que de faire semblant d'avoir envoyé l'email.
 */
async function sendEmailWithAttachment({ to, subject, text, html, filename, buffer }) {
  const transport = getTransport();
  if (!transport) {
    throw new Error("SMTP non configuré (.env) — impossible d'envoyer l'email pour le moment.");
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || `"Garage Elite-Auto" <${process.env.SMTP_USER}>`,
    to, subject, text, html,
    attachments: filename ? [{ filename, content: buffer }] : []
  });
}

module.exports = { sendEmailWithAttachment };
