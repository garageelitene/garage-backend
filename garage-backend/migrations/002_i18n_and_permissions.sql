-- ============================================================
-- Migration 002 — Multilingue (FR/DE/IT/EN) + Permissions
-- Garage Elite-Auto DRN Sarl
-- À exécuter APRÈS schema_mysql.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. LANGUES DISPONIBLES
-- ------------------------------------------------------------
CREATE TABLE languages (
    code       VARCHAR(2) PRIMARY KEY,   -- 'fr','de','it','en'
    label      VARCHAR(50) NOT NULL,
    is_default TINYINT(1) DEFAULT 0,
    active     TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO languages (code, label, is_default, active) VALUES
('fr', 'Français', 1, 1),
('de', 'Deutsch',  0, 1),
('it', 'Italiano', 0, 1),
('en', 'English',  0, 1);

-- ------------------------------------------------------------
-- 2. Ajout de l'italien aux tables déjà multilingues
-- ------------------------------------------------------------
ALTER TABLE service_categories ADD COLUMN name_it VARCHAR(100) AFTER name_de;
UPDATE service_categories SET name_it = name_fr WHERE name_it IS NULL; -- valeur de repli, à traduire en back-office

ALTER TABLE catalog_vehicles ADD COLUMN description_it TEXT AFTER description_de;

-- ------------------------------------------------------------
-- 3. BANNIÈRES DU SLIDER (page d'accueil) — gérées en back-office
-- ------------------------------------------------------------
CREATE TABLE banner_slides (
    id          CHAR(36) PRIMARY KEY,
    sort_order  INT NOT NULL DEFAULT 0,
    image_url   VARCHAR(500),
    link_url    VARCHAR(500),
    active      TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE banner_slide_translations (
    id          CHAR(36) PRIMARY KEY,
    slide_id    CHAR(36) NOT NULL,
    lang_code   VARCHAR(2) NOT NULL,
    title       VARCHAR(200) NOT NULL,
    subtitle    VARCHAR(300),
    cta_label   VARCHAR(60),
    UNIQUE KEY uq_slide_lang (slide_id, lang_code),
    CONSTRAINT fk_slide_translation_slide FOREIGN KEY (slide_id) REFERENCES banner_slides(id) ON DELETE CASCADE,
    CONSTRAINT fk_slide_translation_lang  FOREIGN KEY (lang_code) REFERENCES languages(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3 bannières de démarrage (à modifier depuis le back-office)
INSERT INTO banner_slides (id, sort_order, image_url, link_url, active) VALUES
(UUID(), 1, '/assets/img/banner-entretien.jpg', 'rendez-vous.html', 1),
(UUID(), 2, '/assets/img/banner-vehicules.jpg', 'vehicules.html', 1),
(UUID(), 3, '/assets/img/banner-leasing.jpg', 'vehicules.html#leasing', 1);

-- ------------------------------------------------------------
-- 4. ACTUALITÉS — gérées en back-office, multilingues
-- ------------------------------------------------------------
CREATE TABLE news_items (
    id          CHAR(36) PRIMARY KEY,
    tag         VARCHAR(40),
    image_url   VARCHAR(500),
    published   TINYINT(1) DEFAULT 1,
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE news_item_translations (
    id         CHAR(36) PRIMARY KEY,
    news_id    CHAR(36) NOT NULL,
    lang_code  VARCHAR(2) NOT NULL,
    title      VARCHAR(200) NOT NULL,
    body       TEXT,
    UNIQUE KEY uq_news_lang (news_id, lang_code),
    CONSTRAINT fk_news_translation_news FOREIGN KEY (news_id) REFERENCES news_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_news_translation_lang FOREIGN KEY (lang_code) REFERENCES languages(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 5. CONTENU LIBRE (texte de pages génériques, clé/valeur, multilingue)
--    Permet d'éditer depuis le back-office des blocs de texte
--    sans devoir modifier le code (ex: intro "À propos", accroche accueil...)
-- ------------------------------------------------------------
CREATE TABLE site_content (
    content_key VARCHAR(100) PRIMARY KEY,   -- ex: 'home.intro', 'apropos.text'
    description VARCHAR(200)                -- aide affichée en back-office
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE site_content_translations (
    id          CHAR(36) PRIMARY KEY,
    content_key VARCHAR(100) NOT NULL,
    lang_code   VARCHAR(2) NOT NULL,
    value       TEXT NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_content_lang (content_key, lang_code),
    CONSTRAINT fk_content_translation_key  FOREIGN KEY (content_key) REFERENCES site_content(content_key) ON DELETE CASCADE,
    CONSTRAINT fk_content_translation_lang FOREIGN KEY (lang_code) REFERENCES languages(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 6. PERMISSIONS GRANULAIRES (rôle "administrateur" = accès maximum)
-- ------------------------------------------------------------
CREATE TABLE permissions (
    permission_key VARCHAR(60) PRIMARY KEY,
    description     VARCHAR(200) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO permissions (permission_key, description) VALUES
('appointments.view',      'Voir les rendez-vous'),
('appointments.manage',    'Confirmer / assigner / modifier les rendez-vous'),
('sinistres.view',         'Voir les déclarations de sinistre'),
('sinistres.manage',       'Traiter les déclarations de sinistre'),
('immatriculation.view',   'Voir les demandes d\'immatriculation'),
('immatriculation.manage', 'Traiter les demandes d\'immatriculation'),
('content.manage',         'Gérer les bannières, actualités et textes du site (toutes langues)'),
('catalog.manage',         'Gérer le catalogue véhicules, leasing, abonnements, locations'),
('invoices.manage',        'Gérer factures et paiements'),
('staff.manage',           'Créer / modifier les comptes du personnel et leurs rôles'),
('clients.manage',         'Voir et modifier les fiches clients'),
('audit.view',             'Consulter le journal d\'audit / sécurité'),
('settings.manage',        'Modifier les paramètres généraux du garage (langues actives, horaires, etc.)');

CREATE TABLE role_permissions (
    role            VARCHAR(30) NOT NULL,
    permission_key  VARCHAR(60) NOT NULL,
    PRIMARY KEY (role, permission_key),
    CONSTRAINT fk_role_perm_key FOREIGN KEY (permission_key) REFERENCES permissions(permission_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Le rôle "admin" a TOUTES les permissions (accès maximum) — matérialisé ici,
-- et de toute façon appliqué en code (bypass systématique, voir middleware/permissions.js)
INSERT INTO role_permissions (role, permission_key)
SELECT 'admin', permission_key FROM permissions;

-- Répartition par défaut pour les autres rôles (modifiable ensuite en back-office)
INSERT INTO role_permissions (role, permission_key) VALUES
('conseiller', 'appointments.view'),
('conseiller', 'appointments.manage'),
('conseiller', 'sinistres.view'),
('conseiller', 'sinistres.manage'),
('conseiller', 'immatriculation.view'),
('conseiller', 'immatriculation.manage'),
('conseiller', 'clients.manage'),
('conseiller', 'catalog.manage'),
('conseiller', 'content.manage'),
('mecanicien', 'appointments.view'),
('mecanicien', 'appointments.manage'),
('carrossier', 'appointments.view'),
('carrossier', 'appointments.manage'),
('carrossier', 'sinistres.view');

-- ------------------------------------------------------------
-- 7. Traçabilité : qui a modifié quel contenu (utilise déjà audit_log)
--    -> aucune nouvelle table nécessaire, audit_log est générique.
-- ------------------------------------------------------------
