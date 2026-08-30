-- ============================================================
-- Migration 004 — Simplification des moyens de paiement
-- Garage Elite-Auto DRN Sarl — MySQL / Infomaniak
--
-- Décision : pas de paiement en ligne sur le site. Les clients règlent :
--   - par facture (virement bancaire / QR-facture),
--   - sur place au garage par terminal de paiement (carte, TWINT via le terminal),
--   - sur place en espèces.
-- À exécuter APRÈS schema_mysql.sql et migrations/002_*.sql et 003_*.sql
-- ============================================================

-- MySQL nomme automatiquement les contraintes CHECK (ex: payments_chk_1),
-- ce qui rend leur modification directe fragile depuis un simple copier-coller
-- dans phpMyAdmin. Par sécurité et simplicité, on ne touche pas à la contrainte
-- existante : elle reste permissive (elle acceptait déjà 'mypos_online' et
-- 'twint'), mais l'application n'utilisera plus jamais ces valeurs — seules
-- 'terminal', 'qr_bill' et 'cash' seront proposées et acceptées côté API
-- (voir src/routes/billing.js).

-- Les paiements existants enregistrés en 'mypos_online' ou 'twint' (le cas échéant)
-- sont reclassés en 'terminal', puisqu'en pratique myPOS gère aussi TWINT sur le
-- terminal physique du garage.
UPDATE payments SET method = 'terminal' WHERE method IN ('mypos_online', 'twint');
