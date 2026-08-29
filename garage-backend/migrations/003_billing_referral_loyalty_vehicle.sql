-- ============================================================
-- Migration 003 — Facturation TVA, Parrainage, Fidélité,
-- Notifications véhicule (par immatriculation)
-- Garage Elite-Auto DRN Sarl — MySQL / Infomaniak
-- À exécuter APRÈS schema_mysql.sql et migrations/002_*.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. FACTURATION — modèles de pièces/services, lignes de facture, TVA
-- ------------------------------------------------------------

-- Catalogue interne des pièces et prestations facturables (modèles réutilisables)
CREATE TABLE billing_catalog (
    id            CHAR(36) PRIMARY KEY,
    type          VARCHAR(20) NOT NULL CHECK (type IN ('piece','service')),
    reference     VARCHAR(60),                 -- référence pièce / code prestation interne
    label_fr      VARCHAR(200) NOT NULL,
    label_de      VARCHAR(200),
    label_it      VARCHAR(200),
    label_en      VARCHAR(200),
    unit_price_chf DECIMAL(10,2) NOT NULL,
    default_vat_rate DECIMAL(4,2) NOT NULL DEFAULT 8.10,  -- 8.10 (standard CH), 2.60 (réduit), 0.00 (exonéré/export)
    active        TINYINT(1) DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Modèles de mise en page de facture (personnalisables en back-office)
CREATE TABLE invoice_templates (
    id           CHAR(36) PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    is_default   TINYINT(1) DEFAULT 0,
    logo_url     VARCHAR(500),
    accent_color VARCHAR(7) DEFAULT '#D62828',
    footer_text  TEXT,                          -- ex: IBAN, mentions légales, TVA n°
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO invoice_templates (id, name, is_default, accent_color, footer_text) VALUES
(UUID(), 'Modèle standard', 1, '#D62828',
 'Garage Elite-Auto DRN Sarl — Rue des Draizes 51, 2000 Neuchâtel — IBAN à compléter — N° TVA à compléter');

-- Extension de la table "invoices" (déjà créée dans schema_mysql.sql) pour la TVA et l'international
ALTER TABLE invoices
  ADD COLUMN invoice_number   VARCHAR(30) UNIQUE AFTER id,
  ADD COLUMN template_id      CHAR(36) AFTER invoice_number,
  ADD COLUMN billing_country  VARCHAR(2) DEFAULT 'CH' AFTER client_id,   -- ISO pays du client facturé
  ADD COLUMN is_export        TINYINT(1) DEFAULT 0,                      -- 1 = hors Suisse, TVA non applicable
  ADD COLUMN subtotal_chf     DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN vat_amount_chf   DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN total_chf        DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN lang_code        VARCHAR(2) DEFAULT 'fr',                   -- langue d'émission de la facture
  ADD COLUMN pdf_url          VARCHAR(500),
  ADD COLUMN sent_at          DATETIME,
  ADD CONSTRAINT fk_invoice_template FOREIGN KEY (template_id) REFERENCES invoice_templates(id);

-- Lignes de facture (pièces / services / texte libre), chacune avec son propre taux de TVA
CREATE TABLE invoice_items (
    id           CHAR(36) PRIMARY KEY,
    invoice_id   CHAR(36) NOT NULL,
    catalog_id   CHAR(36),                      -- lien optionnel vers billing_catalog (modèle utilisé)
    description  VARCHAR(300) NOT NULL,
    quantity     DECIMAL(8,2) NOT NULL DEFAULT 1,
    unit_price_chf DECIMAL(10,2) NOT NULL,
    vat_rate     DECIMAL(4,2) NOT NULL DEFAULT 8.10,  -- 8.10 standard / 0.00 export ou exonéré
    line_total_chf DECIMAL(10,2) NOT NULL,
    sort_order   INT DEFAULT 0,
    CONSTRAINT fk_item_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_catalog FOREIGN KEY (catalog_id) REFERENCES billing_catalog(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Quelques modèles de démarrage (à compléter en back-office)
INSERT INTO billing_catalog (id, type, reference, label_fr, label_de, label_it, label_en, unit_price_chf, default_vat_rate) VALUES
(UUID(), 'service', 'SVC-VID', 'Vidange + filtre à huile', 'Ölwechsel + Ölfilter', 'Cambio olio + filtro', 'Oil change + filter', 120.00, 8.10),
(UUID(), 'service', 'SVC-FRE', 'Remplacement plaquettes de frein (train)', 'Bremsbeläge ersetzen (Achse)', 'Sostituzione pastiglie freno (asse)', 'Brake pads replacement (axle)', 180.00, 8.10),
(UUID(), 'service', 'SVC-PNE', 'Montage + équilibrage 4 pneus', 'Montage + Auswuchten 4 Reifen', 'Montaggio + equilibratura 4 pneumatici', '4-tyre fitting + balancing', 80.00, 8.10),
(UUID(), 'piece',   'PC-FILT', 'Filtre à air', 'Luftfilter', 'Filtro aria', 'Air filter', 35.00, 8.10),
(UUID(), 'service', 'SVC-DIAG', 'Diagnostic électronique', 'Elektronische Diagnose', 'Diagnosi elettronica', 'Electronic diagnostics', 90.00, 8.10),
(UUID(), 'service', 'SVC-EXPORT', 'Prestation facturée à l’étranger (hors TVA CH)', 'Leistung im Ausland (ohne CH-MWST)', 'Prestazione estero (senza IVA CH)', 'Service billed abroad (CH VAT exempt)', 0.00, 0.00);

-- ------------------------------------------------------------
-- 2. PROGRAMME DE PARRAINAGE
-- ------------------------------------------------------------
CREATE TABLE referral_codes (
    client_id   CHAR(36) PRIMARY KEY,
    code        VARCHAR(16) UNIQUE NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_referral_code_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE referrals (
    id                 CHAR(36) PRIMARY KEY,
    referrer_client_id CHAR(36) NOT NULL,        -- parrain
    referred_client_id CHAR(36) NOT NULL,        -- filleul
    code_used          VARCHAR(16) NOT NULL,
    status             VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','qualified','rewarded','cancelled')),
    -- "qualified" = filleul a effectué son 1er rendez-vous / achat ; "rewarded" = récompense créditée
    reward_points      INT DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    qualified_at       DATETIME,
    rewarded_at        DATETIME,
    UNIQUE KEY uq_referral_referred (referred_client_id),  -- un filleul ne peut être parrainé qu'une fois
    CONSTRAINT fk_referral_referrer FOREIGN KEY (referrer_client_id) REFERENCES clients(id),
    CONSTRAINT fk_referral_referred FOREIGN KEY (referred_client_id) REFERENCES clients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 3. PROGRAMME DE FIDÉLITÉ
-- ------------------------------------------------------------
CREATE TABLE loyalty_accounts (
    client_id      CHAR(36) PRIMARY KEY,
    points_balance INT DEFAULT 0,
    tier           VARCHAR(20) DEFAULT 'standard' CHECK (tier IN ('standard','argent','or')),
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_loyalty_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE loyalty_transactions (
    id           CHAR(36) PRIMARY KEY,
    client_id    CHAR(36) NOT NULL,
    points       INT NOT NULL,                   -- positif = crédit, négatif = utilisation
    reason       VARCHAR(100) NOT NULL,           -- 'invoice_paid','referral_reward','manual_adjustment','redeemed'
    related_type VARCHAR(30),                     -- 'invoice','referral', etc.
    related_id   CHAR(36),
    created_by   CHAR(36),                        -- staff.id si ajustement manuel, NULL si automatique
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_loyalty_tx_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Règle simple par défaut : 1 point par CHF payé (modifiable en back-office plus tard via site_content ou table dédiée)
CREATE TABLE loyalty_rules (
    rule_key    VARCHAR(50) PRIMARY KEY,
    value       VARCHAR(100) NOT NULL,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO loyalty_rules (rule_key, value, description) VALUES
('points_per_chf', '1', 'Nombre de points crédités par franc payé sur une facture'),
('referral_reward_points', '50', 'Points crédités au parrain quand le filleul est qualifié'),
('points_value_chf', '0.05', 'Valeur en CHF d’un point lors d’une utilisation (1 pt = 5 centimes)');

-- ------------------------------------------------------------
-- 4. SUIVI VÉHICULE PAR IMMATRICULATION + NOTIFICATIONS
-- ------------------------------------------------------------

-- Prochaine échéance d'entretien connue pour un véhicule (alimentée après chaque RDV terminé)
ALTER TABLE client_vehicles
  ADD COLUMN next_service_due_date DATE AFTER mileage_km,
  ADD COLUMN next_service_due_km   INT AFTER next_service_due_date;

-- Notifications liées à un véhicule : pièce changée, rappel d'entretien, information spéciale
CREATE TABLE vehicle_notifications (
    id          CHAR(36) PRIMARY KEY,
    vehicle_id  CHAR(36) NOT NULL,
    client_id   CHAR(36) NOT NULL,
    type        VARCHAR(30) NOT NULL CHECK (type IN ('part_replaced','service_due','special','appointment_update')),
    title       VARCHAR(150) NOT NULL,
    message     TEXT,
    read_at     DATETIME,
    created_by  CHAR(36),                        -- staff.id à l'origine de la notification
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vnotif_vehicle FOREIGN KEY (vehicle_id) REFERENCES client_vehicles(id) ON DELETE CASCADE,
    CONSTRAINT fk_vnotif_client  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_vnotif_client ON vehicle_notifications(client_id);
CREATE INDEX idx_vnotif_vehicle ON vehicle_notifications(vehicle_id);

-- ------------------------------------------------------------
-- 5. Nouvelles permissions liées à ces modules
-- ------------------------------------------------------------
INSERT INTO permissions (permission_key, description) VALUES
('invoices.create',   'Créer et envoyer des factures'),
('billing_catalog.manage', 'Gérer le catalogue de pièces/services facturables et les modèles de facture'),
('loyalty.manage',    'Gérer les points de fidélité et ajustements manuels'),
('referrals.manage',  'Gérer et valider les parrainages'),
('vehicle_notifications.manage', 'Envoyer des notifications aux clients au sujet de leur véhicule');

-- Le rôle admin hérite automatiquement de tout (voir migration 002).
INSERT INTO role_permissions (role, permission_key)
SELECT 'admin', permission_key FROM permissions
WHERE permission_key IN ('invoices.create','billing_catalog.manage','loyalty.manage','referrals.manage','vehicle_notifications.manage');

INSERT INTO role_permissions (role, permission_key) VALUES
('conseiller', 'invoices.create'),
('conseiller', 'billing_catalog.manage'),
('conseiller', 'loyalty.manage'),
('conseiller', 'referrals.manage'),
('conseiller', 'vehicle_notifications.manage'),
('mecanicien', 'vehicle_notifications.manage'),
('carrossier', 'vehicle_notifications.manage');
