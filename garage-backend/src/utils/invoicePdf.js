const PDFDocument = require('pdfkit');

const LABELS = {
  fr: { invoice: 'Facture', client: 'Client', date: 'Date', number: 'N° facture', description: 'Description',
        qty: 'Qté', unit_price: 'Prix unitaire', vat: 'TVA', total: 'Total', subtotal: 'Sous-total',
        vat_amount: 'Montant TVA', grand_total: 'Total à payer', export_note: "Facturation à l'étranger — TVA suisse non applicable (art. 8 LTVA, prestation à l'export).",
        thanks: 'Merci de votre confiance.' },
  de: { invoice: 'Rechnung', client: 'Kunde', date: 'Datum', number: 'Rechnungsnr.', description: 'Beschreibung',
        qty: 'Menge', unit_price: 'Einzelpreis', vat: 'MWST', total: 'Total', subtotal: 'Zwischensumme',
        vat_amount: 'MWST-Betrag', grand_total: 'Zu zahlender Betrag', export_note: 'Rechnung ins Ausland — Schweizer MWST nicht anwendbar (Art. 8 MWSTG, Exportleistung).',
        thanks: 'Vielen Dank für Ihr Vertrauen.' },
  it: { invoice: 'Fattura', client: 'Cliente', date: 'Data', number: 'N. fattura', description: 'Descrizione',
        qty: 'Qtà', unit_price: 'Prezzo unitario', vat: 'IVA', total: 'Totale', subtotal: 'Subtotale',
        vat_amount: 'Importo IVA', grand_total: 'Totale da pagare', export_note: "Fatturazione all'estero — IVA svizzera non applicabile (art. 8 LIVA, prestazione export).",
        thanks: 'Grazie per la fiducia.' },
  en: { invoice: 'Invoice', client: 'Client', date: 'Date', number: 'Invoice no.', description: 'Description',
        qty: 'Qty', unit_price: 'Unit price', vat: 'VAT', total: 'Total', subtotal: 'Subtotal',
        vat_amount: 'VAT amount', grand_total: 'Total due', export_note: 'Cross-border invoice — Swiss VAT not applicable (export supply).',
        thanks: 'Thank you for your trust.' }
};

/**
 * Construit un PDF de facture A4 et le retourne sous forme de Buffer.
 * @param {object} invoice   ligne de la table `invoices` (déjà enrichie : invoice_number, totals, lang_code, is_export...)
 * @param {array}  items     lignes de `invoice_items`
 * @param {object} client    { first_name, last_name, email, address, postal_code, city }
 * @param {object} template  ligne de `invoice_templates` (logo_url, accent_color, footer_text)
 */
function buildInvoicePdf(invoice, items, client, template) {
  return new Promise((resolve, reject) => {
    const lang = LABELS[invoice.lang_code] ? invoice.lang_code : 'fr';
    const t = LABELS[lang];
    const accent = template?.accent_color || '#D62828';

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- En-tête ---
    doc.fillColor(accent).fontSize(22).font('Helvetica-Bold').text('Garage Elite-Auto DRN Sarl', 50, 50);
    doc.fillColor('#1B1F23').fontSize(9).font('Helvetica')
      .text('Rue des Draizes 51, 2000 Neuchâtel', 50, 78)
      .text('Tél. 032 725 50 60', 50, 91);

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1B1F23').text(t.invoice.toUpperCase(), 400, 50, { align: 'right' });
    doc.fontSize(9).font('Helvetica')
      .text(`${t.number} : ${invoice.invoice_number || '—'}`, 400, 78, { align: 'right' })
      .text(`${t.date} : ${new Date(invoice.created_at || Date.now()).toLocaleDateString('fr-CH')}`, 400, 91, { align: 'right' });

    doc.moveTo(50, 115).lineTo(545, 115).strokeColor(accent).lineWidth(1.5).stroke();

    // --- Client ---
    doc.fontSize(9).fillColor('#3A4048').text(t.client.toUpperCase(), 50, 130);
    doc.fontSize(11).fillColor('#1B1F23').font('Helvetica-Bold')
      .text(`${client.first_name} ${client.last_name}`, 50, 144);
    doc.font('Helvetica').fontSize(10)
      .text(client.address || '', 50, 160)
      .text(`${client.postal_code || ''} ${client.city || ''}`, 50, 174)
      .text(client.email || '', 50, 188);

    // --- Tableau des lignes ---
    let y = 230;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.rect(50, y, 495, 22).fill(accent);
    doc.fillColor('#FFFFFF')
      .text(t.description, 58, y + 6, { width: 220 })
      .text(t.qty, 285, y + 6, { width: 40, align: 'right' })
      .text(t.unit_price, 330, y + 6, { width: 70, align: 'right' })
      .text(t.vat, 405, y + 6, { width: 50, align: 'right' })
      .text(t.total, 460, y + 6, { width: 78, align: 'right' });
    y += 22;

    doc.font('Helvetica').fillColor('#1B1F23');
    items.forEach((item, i) => {
      const rowH = 20;
      if (i % 2 === 1) { doc.rect(50, y, 495, rowH).fill('#F5F4F1'); doc.fillColor('#1B1F23'); }
      doc.fontSize(9)
        .text(item.description, 58, y + 6, { width: 220 })
        .text(String(item.quantity), 285, y + 6, { width: 40, align: 'right' })
        .text(`CHF ${Number(item.unit_price_chf).toFixed(2)}`, 330, y + 6, { width: 70, align: 'right' })
        .text(`${Number(item.vat_rate).toFixed(2)}%`, 405, y + 6, { width: 50, align: 'right' })
        .text(`CHF ${Number(item.line_total_chf).toFixed(2)}`, 460, y + 6, { width: 78, align: 'right' });
      y += rowH;
    });

    y += 10;
    doc.moveTo(330, y).lineTo(545, y).strokeColor('#D8D5CE').lineWidth(1).stroke();
    y += 10;

    doc.fontSize(9).font('Helvetica')
      .text(t.subtotal, 330, y, { width: 130 })
      .text(`CHF ${Number(invoice.subtotal_chf).toFixed(2)}`, 460, y, { width: 78, align: 'right' });
    y += 16;
    doc.text(t.vat_amount, 330, y, { width: 130 })
      .text(`CHF ${Number(invoice.vat_amount_chf).toFixed(2)}`, 460, y, { width: 78, align: 'right' });
    y += 20;

    doc.rect(330, y, 215, 24).fill(accent);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
      .text(t.grand_total, 338, y + 7, { width: 130 })
      .text(`CHF ${Number(invoice.total_chf).toFixed(2)}`, 460, y + 7, { width: 78, align: 'right' });
    y += 40;

    if (invoice.is_export) {
      doc.fillColor('#3A4048').font('Helvetica-Oblique').fontSize(8.5)
        .text(t.export_note, 50, y, { width: 495 });
      y += 24;
    }

    // --- Pied de page (personnalisable en back-office) ---
    doc.fontSize(8).fillColor('#8A9099').font('Helvetica')
      .text(template?.footer_text || 'Garage Elite-Auto DRN Sarl — Rue des Draizes 51, 2000 Neuchâtel', 50, 760, { width: 495, align: 'center' });
    doc.fontSize(9).fillColor('#1B1F23').font('Helvetica-Oblique')
      .text(t.thanks, 50, y + 6, { width: 495, align: 'center' });

    doc.end();
  });
}

module.exports = { buildInvoicePdf };
