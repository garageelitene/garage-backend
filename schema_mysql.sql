-- ============================================================
-- Garage Elite-Auto DRN Sarl — Schéma de base de données
-- MySQL 8 / MariaDB 10.5+ (hébergement Infomaniak)
-- Les identifiants (id) sont des UUID générés côté application
-- (crypto.randomUUID()) et fournis explicitement à l'INSERT.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------
-- CLIENTS (espace client)
-- ------------------------------------------------------------
CREATE TABLE clients (
    id                  CHAR(36) PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    first_name          VARCHAR(100) NOT NULL,
    last_name           VARCHAR(100) NOT NULL,
    phone               VARCHAR(30),
    address             VARCHAR(255),
    postal_code         VARCHAR(10),
    city                VARCHAR(100),
    preferred_language  VARCHAR(2) DEFAULT 'fr' CHECK (preferred_language IN ('fr','de','en')),
    email_verified      TINYINT(1) DEFAULT 0,
    reset_token_hash    VARCHAR(255),
    reset_token_expires DATETIME,
    failed_login_count  INT DEFAULT 0,
    locked_until        DATETIME,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- STAFF (back-office : mécaniciens, conseillers, admin)
-- ------------------------------------------------------------
CREATE TABLE staff (
    id             CHAR(36) PRIMARY KEY,
    email          VARCHAR(255) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    full_name      VARCHAR(150) NOT NULL,
    role           VARCHAR(30) NOT NULL CHECK (role IN ('admin','conseiller','mecanicien','carrossier')),
    active         TINYINT(1) DEFAULT 1,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- VÉHICULES DES CLIENTS
-- ------------------------------------------------------------
CREATE TABLE client_vehicles (
    id              CHAR(36) PRIMARY KEY,
    client_id       CHAR(36) NOT NULL,
    plate_number    VARCHAR(20) NOT NULL,
    brand           VARCHAR(50) NOT NULL,
    model           VARCHAR(50) NOT NULL,
    year            INT,
    vin             VARCHAR(30),
    mileage_km      INT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_client_plate (client_id, plate_number),
    CONSTRAINT fk_vehicle_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- CATÉGORIES DE SERVICES (multilingue)
-- ------------------------------------------------------------
CREATE TABLE service_categories (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    code          VARCHAR(30) UNIQUE NOT NULL,
    name_fr       VARCHAR(100) NOT NULL,
    name_de       VARCHAR(100) NOT NULL,
    name_en       VARCHAR(100) NOT NULL,
    default_duration_minutes INT DEFAULT 60
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- RENDEZ-VOUS
-- ------------------------------------------------------------
CREATE TABLE appointments (
    id                  CHAR(36) PRIMARY KEY,
    client_id           CHAR(36) NOT NULL,
    vehicle_id          CHAR(36),
    category_id         INT NOT NULL,
    staff_id            CHAR(36),
    scheduled_at        DATETIME NOT NULL,
    duration_minutes    INT NOT NULL DEFAULT 60,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
    notes               TEXT,
    reschedule_count    INT DEFAULT 0,
    cancelled_at        DATETIME,
    cancellation_reason VARCHAR(255),
    reminder_sent       TINYINT(1) DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_appt_client   FOREIGN KEY (client_id)  REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_appt_vehicle  FOREIGN KEY (vehicle_id) REFERENCES client_vehicles(id) ON DELETE SET NULL,
    CONSTRAINT fk_appt_category FOREIGN KEY (category_id) REFERENCES service_categories(id),
    CONSTRAINT fk_appt_staff    FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_appointments_scheduled_at ON appointments(scheduled_at);
CREATE INDEX idx_appointments_client ON appointments(client_id);
CREATE INDEX idx_appointments_staff ON appointments(staff_id);

CREATE TABLE appointment_status_log (
    id             CHAR(36) PRIMARY KEY,
    appointment_id CHAR(36) NOT NULL,
    old_status     VARCHAR(20),
    new_status     VARCHAR(20),
    changed_by     VARCHAR(20) CHECK (changed_by IN ('client','staff','system')),
    changed_by_id  CHAR(36),
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_log_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- CATALOGUE VÉHICULES (vente / leasing / location / abonnement)
-- ------------------------------------------------------------
CREATE TABLE catalog_vehicles (
    id              CHAR(36) PRIMARY KEY,
    brand           VARCHAR(50) NOT NULL,
    model           VARCHAR(50) NOT NULL,
    year            INT,
    mileage_km      INT,
    price_chf       DECIMAL(10,2),
    listing_type    VARCHAR(20) NOT NULL CHECK (listing_type IN ('vente','leasing','location','abonnement')),
    description_fr  TEXT, description_de TEXT, description_en TEXT,
    images          JSON,
    available       TINYINT(1) DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE leasing_offers (
    id                  CHAR(36) PRIMARY KEY,
    catalog_vehicle_id  CHAR(36) NOT NULL,
    monthly_payment_chf DECIMAL(10,2) NOT NULL,
    duration_months     INT NOT NULL,
    down_payment_chf    DECIMAL(10,2) DEFAULT 0,
    mileage_limit_km    INT,
    CONSTRAINT fk_leasing_vehicle FOREIGN KEY (catalog_vehicle_id) REFERENCES catalog_vehicles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subscriptions (
    id                  CHAR(36) PRIMARY KEY,
    client_id           CHAR(36) NOT NULL,
    catalog_vehicle_id  CHAR(36) NOT NULL,
    monthly_price_chf   DECIMAL(10,2) NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE,
    status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','cancelled','completed')),
    CONSTRAINT fk_sub_client  FOREIGN KEY (client_id) REFERENCES clients(id),
    CONSTRAINT fk_sub_vehicle FOREIGN KEY (catalog_vehicle_id) REFERENCES catalog_vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rentals (
    id                  CHAR(36) PRIMARY KEY,
    client_id           CHAR(36) NOT NULL,
    catalog_vehicle_id  CHAR(36) NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    daily_price_chf     DECIMAL(10,2) NOT NULL,
    status              VARCHAR(20) DEFAULT 'reserved' CHECK (status IN ('reserved','ongoing','completed','cancelled')),
    CONSTRAINT fk_rental_client  FOREIGN KEY (client_id) REFERENCES clients(id),
    CONSTRAINT fk_rental_vehicle FOREIGN KEY (catalog_vehicle_id) REFERENCES catalog_vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- FACTURATION & PAIEMENTS (myPOS, TWINT, QR-facture, espèces)
-- ------------------------------------------------------------
CREATE TABLE invoices (
    id             CHAR(36) PRIMARY KEY,
    client_id      CHAR(36) NOT NULL,
    appointment_id CHAR(36),
    amount_chf     DECIMAL(10,2) NOT NULL,
    status         VARCHAR(20) DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled','refunded')),
    qr_reference   VARCHAR(50),
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at        DATETIME,
    CONSTRAINT fk_invoice_client      FOREIGN KEY (client_id) REFERENCES clients(id),
    CONSTRAINT fk_invoice_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payments (
    id                      CHAR(36) PRIMARY KEY,
    invoice_id              CHAR(36) NOT NULL,
    method                  VARCHAR(20) NOT NULL CHECK (method IN ('mypos_online','mypos_terminal','twint','qr_bill','cash')),
    provider_transaction_id VARCHAR(100),
    amount_chf              DECIMAL(10,2) NOT NULL,
    status                  VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- DÉCLARATIONS DE SINISTRE
-- ------------------------------------------------------------
CREATE TABLE sinistre_reports (
    id                 CHAR(36) PRIMARY KEY,
    client_id          CHAR(36) NOT NULL,
    vehicle_id         CHAR(36),
    description        TEXT NOT NULL,
    photos             JSON,
    insurance_name     VARCHAR(100),
    insurance_contact  VARCHAR(150),
    status             VARCHAR(20) DEFAULT 'nouveau' CHECK (status IN ('nouveau','en_cours','traite')),
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sinistre_client  FOREIGN KEY (client_id) REFERENCES clients(id),
    CONSTRAINT fk_sinistre_vehicle FOREIGN KEY (vehicle_id) REFERENCES client_vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- DEMANDES D'ASSISTANCE IMMATRICULATION / PERMIS DE CIRCULATION
-- ------------------------------------------------------------
CREATE TABLE immatriculation_requests (
    id            CHAR(36) PRIMARY KEY,
    client_id     CHAR(36) NOT NULL,
    vehicle_id    CHAR(36),
    request_type  VARCHAR(50) NOT NULL,
    notes         TEXT,
    status        VARCHAR(20) DEFAULT 'nouveau' CHECK (status IN ('nouveau','en_cours','traite')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_immat_client  FOREIGN KEY (client_id) REFERENCES clients(id),
    CONSTRAINT fk_immat_vehicle FOREIGN KEY (vehicle_id) REFERENCES client_vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- JOURNAL D'AUDIT (sécurité)
-- ------------------------------------------------------------
CREATE TABLE audit_log (
    id          CHAR(36) PRIMARY KEY,
    actor_type  VARCHAR(20) CHECK (actor_type IN ('client','staff','system')),
    actor_id    CHAR(36),
    action      VARCHAR(100) NOT NULL,
    entity      VARCHAR(50),
    entity_id   CHAR(36),
    ip_address  VARCHAR(45),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Données de référence : catégories de services
-- ------------------------------------------------------------
INSERT INTO service_categories (code, name_fr, name_de, name_en, default_duration_minutes) VALUES
('entretien',    'Entretien',    'Wartung',        'Maintenance',      60),
('reparation',   'Réparation',   'Reparatur',      'Repair',           90),
('carrosserie',  'Carrosserie',  'Karosserie',     'Bodywork',        120),
('accessoires',  'Accessoires',  'Zubehör',        'Accessories',      30),
('essai',        'Essai véhicule','Probefahrt',    'Test drive',       45),
('expertise',    'Expertise leasing/location', 'Leasing-/Mietbewertung', 'Leasing/Rental appraisal', 45);
