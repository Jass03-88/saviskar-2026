import { PDFDocument, StandardFonts, rgb, setFontAndSize } from 'pdf-lib';

export type ReceiptLineItem = {
  eventName: string;
  category?: string | null;
  registrationType?: 'individual' | 'team';
  teamName?: string | null;
  amount: number;
};

export type ReceiptData = {
  // Receipt identity
  receiptReference: string;
  paymentDate: string;

  // Participant
  participantName: string;
  participantId: string;
  email: string;
  phone: string | null;
  college: string;

  // Registration items (multi-event support)
  items?: ReceiptLineItem[];

  // Single-event backward compatibility fields
  eventName?: string;
  eventCategory?: string | null;
  registrationType?: 'individual' | 'team';
  teamName?: string | null;

  // Payment
  amount: number;
  gateway: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawDivider(page: any, y: number) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

export async function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let cursorY = PAGE_HEIGHT - 60;

  // Normalize line items
  const lineItems: ReceiptLineItem[] =
    data.items && data.items.length > 0
      ? data.items
      : [
          {
            eventName: data.eventName || 'Saviskar Event',
            category: data.eventCategory || null,
            registrationType: data.registrationType || 'individual',
            teamName: data.teamName || null,
            amount: data.amount,
          },
        ];

  // --- HEADER ---
  page.drawText('SAVISKAR 2026', {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helveticaBold,
    color: rgb(0.4, 0.4, 0.4),
  });

  cursorY -= 40;

  // "PAYMENT RECEIPT" and "PAID" badge
  page.drawText('PAYMENT RECEIPT', {
    x: MARGIN,
    y: cursorY,
    size: 24,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  // PAID badge
  const badgeText = 'PAID';
  const badgeSize = 10;
  const badgeWidth = helveticaBold.widthOfTextAtSize(badgeText, badgeSize) + 20;
  const badgeHeight = 20;
  
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeWidth,
    y: cursorY - 3,
    width: badgeWidth,
    height: badgeHeight,
    color: rgb(0.85, 0.95, 0.85),
    borderColor: rgb(0.5, 0.8, 0.5),
    borderWidth: 1,
  });

  page.drawText(badgeText, {
    x: PAGE_WIDTH - MARGIN - badgeWidth + 10,
    y: cursorY + 3,
    size: badgeSize,
    font: helveticaBold,
    color: rgb(0.1, 0.5, 0.1),
  });

  cursorY -= 30;

  page.drawText(`Receipt No: ${data.receiptReference}`, {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  cursorY -= 15;

  page.drawText(`Payment Date: ${data.paymentDate}`, {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  cursorY -= 30;
  drawDivider(page, cursorY);
  cursorY -= 30;

  // --- HELPER FUNCTION FOR SECTIONS ---
  const drawSectionTitle = (title: string) => {
    page.drawText(title, {
      x: MARGIN,
      y: cursorY,
      size: 9,
      font: helveticaBold,
      color: rgb(0.5, 0.5, 0.5),
    });
    cursorY -= 20;
  };

  const drawRow = (label: string, value: string, font = helvetica, size = 10) => {
    // Label
    page.drawText(label, {
      x: MARGIN,
      y: cursorY,
      size: 9,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
    
    // Value wrapping
    const maxValWidth = CONTENT_WIDTH - 150;
    const lines = wrapText(value, font, size, maxValWidth);
    
    for (const line of lines) {
      page.drawText(line, {
        x: MARGIN + 150,
        y: cursorY,
        size,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 14;
    }
    cursorY -= 4;
  };

  // --- PARTICIPANT ---
  drawSectionTitle('PARTICIPANT');
  drawRow('Name', data.participantName, helveticaBold, 11);
  drawRow('Participant ID', data.participantId, helveticaBold, 10);
  drawRow('Email', data.email);
  if (data.phone) {
    drawRow('Contact Number', data.phone);
  }
  drawRow('College / Institution', data.college);

  cursorY -= 12;
  drawDivider(page, cursorY);
  cursorY -= 20;

  // --- REGISTRATION ---
  if (lineItems.length === 1) {
    const single = lineItems[0];
    drawSectionTitle('REGISTRATION');
    drawRow('Event Name', single.eventName, helveticaBold, 11);
    if (single.category) {
      drawRow('Category', single.category);
    }
    drawRow('Registration Type', single.registrationType === 'team' ? 'Team' : 'Individual');
    if (single.registrationType === 'team' && single.teamName) {
      drawRow('Team', single.teamName);
    }
  } else {
    drawSectionTitle(`REGISTRATION (${lineItems.length} EVENTS)`);
    lineItems.forEach((item, index) => {
      const typeInfo = item.registrationType === 'team' && item.teamName
        ? `Team: ${item.teamName}`
        : item.registrationType === 'team' ? 'Team' : 'Individual';
      const categoryInfo = item.category ? ` (${item.category})` : '';
      drawRow(`Event ${index + 1}`, `${item.eventName}${categoryInfo} — ${typeInfo}`);
    });
  }

  cursorY -= 12;
  drawDivider(page, cursorY);
  cursorY -= 20;

  // --- PAYMENT DETAILS ---
  drawSectionTitle('PAYMENT DETAILS');
  drawRow('Status', 'PAID', helveticaBold, 10);
  drawRow('Gateway', data.gateway);
  drawRow('Order ID', data.gatewayOrderId);
  drawRow('Payment ID', data.gatewayPaymentId);
  drawRow('Payment Date', data.paymentDate);

  cursorY -= 12;
  drawDivider(page, cursorY);
  cursorY -= 25;

  // --- PAYMENT SUMMARY ---
  drawSectionTitle('PAYMENT SUMMARY');
  
  // Table header
  page.drawText('Description', {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  page.drawText('Amount', {
    x: PAGE_WIDTH - MARGIN - 70,
    y: cursorY,
    size: 10,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  cursorY -= 20;

  // Table rows for all line items
  for (const item of lineItems) {
    const itemDesc = `${item.eventName} Registration`;
    const descLines = wrapText(itemDesc, helvetica, 10, CONTENT_WIDTH - 100);

    page.drawText(descLines[0] || itemDesc, {
      x: MARGIN,
      y: cursorY,
      size: 10,
      font: helvetica,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(`INR ${item.amount}`, {
      x: PAGE_WIDTH - MARGIN - 70,
      y: cursorY,
      size: 10,
      font: helvetica,
      color: rgb(0.2, 0.2, 0.2),
    });
    cursorY -= 16;
  }
  
  cursorY -= 5;
  drawDivider(page, cursorY);
  cursorY -= 15;

  // TOTAL
  page.drawText('TOTAL PAID', {
    x: MARGIN,
    y: cursorY,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  page.drawText(`INR ${data.amount}`, {
    x: PAGE_WIDTH - MARGIN - 70,
    y: cursorY,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  // --- FOOTER ---
  console.log(`[PDF] TOTAL PAID rendered at ${cursorY}`);
  const footerY = Math.min(80, cursorY - 50);
  console.log(`[PDF] Footer starts at ${footerY}`);
  drawDivider(page, footerY + 20);
  
  page.drawText('Saviskar 2026', {
    x: MARGIN,
    y: footerY,
    size: 9,
    font: helveticaBold,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  page.drawText('This is an electronically generated payment receipt for Saviskar 2026 registration.', {
    x: MARGIN,
    y: footerY - 15,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });
  
  page.drawText('No physical signature is required.', {
    x: MARGIN,
    y: footerY - 28,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
