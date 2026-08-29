const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
const SUPPORTED_LANGS = ['fr', 'de', 'it', 'en'];

// Toutes les routes ci-dessous exigent la permission 'content.manage'
// (les administrateurs l'ont toujours, quel que soit le paramétrage des rôles).
router.use(requireAuth, requirePermission('content.manage'));

// ============================================================
// BANNIÈRES DU SLIDER
// ============================================================

// GET /backoffice/content/banners — toutes les bannières + leurs traductions
router.get('/banners', async (req, res) => {
  const slides = await db.query('SELECT * FROM banner_slides ORDER BY sort_order ASC');
  const out = [];
  for (const slide of slides.rows) {
    const translations = await db.query(
      'SELECT lang_code, title, subtitle, cta_label FROM banner_slide_translations WHERE slide_id = ?',
      [slide.id]
    );
    out.push({ ...slide, translations: translations.rows });
  }
  res.json(out);
});

// POST /backoffice/content/banners — créer une bannière
router.post('/banners', body('image_url').notEmpty(), body('sort_order').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const id = crypto.randomUUID();
  const { image_url, link_url, sort_order, active = true } = req.body;
  await db.query(
    'INSERT INTO banner_slides (id, sort_order, image_url, link_url, active) VALUES (?,?,?,?,?)',
    [id, sort_order, image_url, link_url || null, active ? 1 : 0]
  );
  res.status(201).json({ id });
});

// PUT /backoffice/content/banners/:id — modifier image / ordre / lien / statut
router.put('/banners/:id', async (req, res) => {
  const { image_url, link_url, sort_order, active } = req.body;
  await db.query(
    `UPDATE banner_slides SET
       image_url = COALESCE(?, image_url), link_url = ?,
       sort_order = COALESCE(?, sort_order), active = COALESCE(?, active)
     WHERE id = ?`,
    [image_url || null, link_url ?? null, sort_order ?? null, active === undefined ? null : (active ? 1 : 0), req.params.id]
  );
  res.json({ message: 'Bannière mise à jour.' });
});

// DELETE /backoffice/content/banners/:id
router.delete('/banners/:id', async (req, res) => {
  await db.query('DELETE FROM banner_slides WHERE id = ?', [req.params.id]);
  res.json({ message: 'Bannière supprimée.' });
});

// PUT /backoffice/content/banners/:id/translations/:lang — texte de la bannière dans une langue
router.put('/banners/:id/translations/:lang', body('title').notEmpty(), async (req, res) => {
  const lang = req.params.lang;
  if (!SUPPORTED_LANGS.includes(lang)) return res.status(400).json({ error: 'Langue non supportée (fr, de, it, en).' });

  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, subtitle, cta_label } = req.body;
  const existing = await db.query(
    'SELECT id FROM banner_slide_translations WHERE slide_id = ? AND lang_code = ?',
    [req.params.id, lang]
  );
  if (existing.rows.length) {
    await db.query('UPDATE banner_slide_translations SET title=?, subtitle=?, cta_label=? WHERE id=?',
      [title, subtitle || null, cta_label || null, existing.rows[0].id]);
  } else {
    await db.query('INSERT INTO banner_slide_translations (id, slide_id, lang_code, title, subtitle, cta_label) VALUES (?,?,?,?,?,?)',
      [crypto.randomUUID(), req.params.id, lang, title, subtitle || null, cta_label || null]);
  }
  res.json({ message: `Traduction (${lang}) enregistrée.` });
});

// ============================================================
// ACTUALITÉS (multilingue)
// ============================================================

router.get('/news', async (req, res) => {
  const items = await db.query('SELECT * FROM news_items ORDER BY published_at DESC');
  const out = [];
  for (const item of items.rows) {
    const translations = await db.query('SELECT lang_code, title, body FROM news_item_translations WHERE news_id = ?', [item.id]);
    out.push({ ...item, translations: translations.rows });
  }
  res.json(out);
});

router.post('/news', async (req, res) => {
  const id = crypto.randomUUID();
  const { tag, image_url, published = true } = req.body;
  await db.query('INSERT INTO news_items (id, tag, image_url, published) VALUES (?,?,?,?)', [id, tag || null, image_url || null, published ? 1 : 0]);
  res.status(201).json({ id });
});

router.delete('/news/:id', async (req, res) => {
  await db.query('DELETE FROM news_items WHERE id = ?', [req.params.id]);
  res.json({ message: 'Actualité supprimée.' });
});

router.put('/news/:id/translations/:lang', body('title').notEmpty(), async (req, res) => {
  const lang = req.params.lang;
  if (!SUPPORTED_LANGS.includes(lang)) return res.status(400).json({ error: 'Langue non supportée (fr, de, it, en).' });

  const { title, body: text } = req.body;
  const existing = await db.query('SELECT id FROM news_item_translations WHERE news_id = ? AND lang_code = ?', [req.params.id, lang]);
  if (existing.rows.length) {
    await db.query('UPDATE news_item_translations SET title=?, body=? WHERE id=?', [title, text || null, existing.rows[0].id]);
  } else {
    await db.query('INSERT INTO news_item_translations (id, news_id, lang_code, title, body) VALUES (?,?,?,?,?)', [crypto.randomUUID(), req.params.id, lang, title, text || null]);
  }
  res.json({ message: `Traduction (${lang}) enregistrée.` });
});

// ============================================================
// TEXTES LIBRES DU SITE (site_content) — clé/valeur, multilingue
// ============================================================

router.get('/site-content', async (req, res) => {
  const keys = await db.query('SELECT * FROM site_content');
  const out = [];
  for (const k of keys.rows) {
    const translations = await db.query('SELECT lang_code, value FROM site_content_translations WHERE content_key = ?', [k.content_key]);
    out.push({ ...k, translations: translations.rows });
  }
  res.json(out);
});

router.put('/site-content/:key/translations/:lang', body('value').notEmpty(), async (req, res) => {
  const lang = req.params.lang;
  if (!SUPPORTED_LANGS.includes(lang)) return res.status(400).json({ error: 'Langue non supportée (fr, de, it, en).' });

  await db.query('INSERT IGNORE INTO site_content (content_key) VALUES (?)', [req.params.key]);

  const existing = await db.query('SELECT id FROM site_content_translations WHERE content_key = ? AND lang_code = ?', [req.params.key, lang]);
  if (existing.rows.length) {
    await db.query('UPDATE site_content_translations SET value=? WHERE id=?', [req.body.value, existing.rows[0].id]);
  } else {
    await db.query('INSERT INTO site_content_translations (id, content_key, lang_code, value) VALUES (?,?,?,?)', [crypto.randomUUID(), req.params.key, lang, req.body.value]);
  }
  res.json({ message: `Contenu "${req.params.key}" (${lang}) enregistré.` });
});

module.exports = router;
