const express = require('express');
const db = require('../db');

const router = express.Router();
const SUPPORTED_LANGS = ['fr', 'de', 'it', 'en'];
const DEFAULT_LANG = 'fr';

function safeLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

// GET /content/languages — langues actives (pour le sélecteur de langue du site)
router.get('/languages', async (req, res) => {
  const result = await db.query('SELECT code, label, is_default FROM languages WHERE active = 1');
  res.json(result.rows);
});

// GET /content/banners?lang=fr — bannières actives du slider d'accueil (3 par défaut), triées
router.get('/banners', async (req, res) => {
  const lang = safeLang(req.query.lang);
  try {
    const slides = await db.query('SELECT * FROM banner_slides WHERE active = 1 ORDER BY sort_order ASC');
    const out = [];
    for (const slide of slides.rows) {
      const t = await db.query(
        'SELECT title, subtitle, cta_label FROM banner_slide_translations WHERE slide_id = ? AND lang_code = ?',
        [slide.id, lang]
      );
      let translation = t.rows[0];
      if (!translation) {
        const fb = await db.query(
          'SELECT title, subtitle, cta_label FROM banner_slide_translations WHERE slide_id = ? AND lang_code = ?',
          [slide.id, DEFAULT_LANG]
        );
        translation = fb.rows[0] || { title: '', subtitle: '', cta_label: '' };
      }
      out.push({ id: slide.id, image_url: slide.image_url, link_url: slide.link_url, ...translation });
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /content/news?lang=fr — actualités publiées
router.get('/news', async (req, res) => {
  const lang = safeLang(req.query.lang);
  try {
    const items = await db.query('SELECT * FROM news_items WHERE published = 1 ORDER BY published_at DESC LIMIT 20');
    const out = [];
    for (const item of items.rows) {
      const t = await db.query(
        'SELECT title, body FROM news_item_translations WHERE news_id = ? AND lang_code = ?',
        [item.id, lang]
      );
      let translation = t.rows[0];
      if (!translation) {
        const fb = await db.query(
          'SELECT title, body FROM news_item_translations WHERE news_id = ? AND lang_code = ?',
          [item.id, DEFAULT_LANG]
        );
        translation = fb.rows[0] || { title: '', body: '' };
      }
      out.push({ id: item.id, tag: item.tag, image_url: item.image_url, published_at: item.published_at, ...translation });
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
