import { Router } from 'express';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from '../db.js';

export const billingRouter = Router();

function computeInvoice(projectId, startDate, endDate) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return { error: 'project not found', status: 404 };
  if (!project.is_billable) return { error: 'project is not marked billable', status: 400 };

  const entries = db.prepare(`
    SELECT te.*, u.name AS user_name
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    WHERE te.project_id = ? AND te.status = 'approved'
      AND te.started_at >= ? AND te.started_at < ?
    ORDER BY u.name
  `).all(projectId, `${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`);

  const byUser = {};
  for (const e of entries) {
    const hours = (new Date(e.ended_at) - new Date(e.started_at)) / 3600000;
    if (!byUser[e.user_name]) byUser[e.user_name] = 0;
    byUser[e.user_name] += hours;
  }

  const lineItems = Object.entries(byUser).map(([userName, hours]) => ({
    userName,
    hours: Math.round(hours * 100) / 100,
    amount: Math.round(hours * project.hourly_rate * 100) / 100,
  }));
  const totalHours = Math.round(lineItems.reduce((sum, li) => sum + li.hours, 0) * 100) / 100;
  const totalAmount = Math.round(lineItems.reduce((sum, li) => sum + li.amount, 0) * 100) / 100;

  return {
    project: { id: project.id, name: project.name, clientName: project.client_name, hourlyRate: project.hourly_rate },
    startDate,
    endDate,
    lineItems,
    totalHours,
    totalAmount,
  };
}

billingRouter.get('/projects/:id/invoice', (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

  const result = computeInvoice(req.params.id, startDate, endDate);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

billingRouter.get('/projects/:id/invoice.pdf', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

  const invoice = computeInvoice(req.params.id, startDate, endDate);
  if (invoice.error) return res.status(invoice.status).json({ error: invoice.error });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const left = 50;
  const draw = (text, opts = {}) => {
    page.drawText(text, { x: opts.x ?? left, y, size: opts.size ?? 11, font: opts.bold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= opts.gap ?? 18;
  };

  draw('INVOICE', { size: 22, bold: true, gap: 30 });
  draw(invoice.project.name, { size: 14, bold: true, gap: 20 });
  if (invoice.project.clientName) draw(`Client: ${invoice.project.clientName}`, { gap: 16 });
  draw(`Period: ${invoice.startDate} to ${invoice.endDate}`, { gap: 16 });
  draw(`Rate: $${invoice.project.hourlyRate}/hr`, { gap: 30 });

  draw('Employee', { x: left, bold: true });
  page.drawText('Hours', { x: 350, y: y + 18, size: 11, font: bold });
  page.drawText('Amount', { x: 450, y: y + 18, size: 11, font: bold });
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= 16;

  if (invoice.lineItems.length === 0) {
    draw('No approved time entries in this period.', { gap: 18 });
  }
  for (const li of invoice.lineItems) {
    page.drawText(li.userName, { x: left, y, size: 11, font });
    page.drawText(li.hours.toFixed(2), { x: 350, y, size: 11, font });
    page.drawText(`$${li.amount.toFixed(2)}`, { x: 450, y, size: 11, font });
    y -= 18;
  }

  y -= 10;
  page.drawLine({ start: { x: left, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= 20;
  page.drawText('Total', { x: 350, y, size: 12, font: bold });
  page.drawText(`$${invoice.totalAmount.toFixed(2)}`, { x: 450, y, size: 12, font: bold });

  const bytes = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.project.name.replace(/\W+/g, '-')}-${startDate}-${endDate}.pdf"`);
  res.send(Buffer.from(bytes));
});
