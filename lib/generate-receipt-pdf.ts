import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';

export type ReceiptTeamMember = {
  participantId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  college?: string | null;
  isTeamLeader?: boolean;
  role?: string;
};

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

  // Team members (for team registrations)
  teamMembers?: ReceiptTeamMember[];

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

function drawDivider(page: PDFPage, y: number) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
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
  let currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let cursorY = PAGE_HEIGHT - 60;

  // Helper to paginate if content exceeds page bounds
  const checkPageOverflow = (neededHeight: number) => {
    if (cursorY - neededHeight < 80) {
      currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - 50;

      currentPage.drawText('SAVISKAR 2026 — PAYMENT RECEIPT (Contd.)', {
        x: MARGIN,
        y: cursorY,
        size: 9,
        font: helveticaBold,
        color: rgb(0.4, 0.4, 0.4),
      });

      currentPage.drawText(`Receipt No: ${data.receiptReference}`, {
        x: PAGE_WIDTH - MARGIN - 180,
        y: cursorY,
        size: 8,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });

      cursorY -= 12;
      drawDivider(currentPage, cursorY);
      cursorY -= 20;
    }
  };

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
  currentPage.drawText('SAVISKAR 2026', {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helveticaBold,
    color: rgb(0.4, 0.4, 0.4),
  });

  cursorY -= 40;

  // "PAYMENT RECEIPT" and "PAID" badge
  currentPage.drawText('PAYMENT RECEIPT', {
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
  
  currentPage.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeWidth,
    y: cursorY - 3,
    width: badgeWidth,
    height: badgeHeight,
    color: rgb(0.85, 0.95, 0.85),
    borderColor: rgb(0.5, 0.8, 0.5),
    borderWidth: 1,
  });

  currentPage.drawText(badgeText, {
    x: PAGE_WIDTH - MARGIN - badgeWidth + 10,
    y: cursorY + 3,
    size: badgeSize,
    font: helveticaBold,
    color: rgb(0.1, 0.5, 0.1),
  });

  cursorY -= 30;

  currentPage.drawText(`Receipt No: ${data.receiptReference}`, {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  cursorY -= 15;

  currentPage.drawText(`Payment Date: ${data.paymentDate}`, {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  cursorY -= 30;
  drawDivider(currentPage, cursorY);
  cursorY -= 30;

  // --- HELPER FUNCTION FOR SECTIONS ---
  const drawSectionTitle = (title: string) => {
    checkPageOverflow(40);
    currentPage.drawText(title, {
      x: MARGIN,
      y: cursorY,
      size: 9,
      font: helveticaBold,
      color: rgb(0.5, 0.5, 0.5),
    });
    cursorY -= 20;
  };

  const drawRow = (label: string, value: string, font = helvetica, size = 10) => {
    const maxValWidth = CONTENT_WIDTH - 150;
    const lines = wrapText(value, font, size, maxValWidth);
    const needed = Math.max(1, lines.length) * 14 + 6;
    checkPageOverflow(needed);

    currentPage.drawText(label, {
      x: MARGIN,
      y: cursorY,
      size: 9,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
    
    for (const line of lines) {
      currentPage.drawText(line, {
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
  drawDivider(currentPage, cursorY);
  cursorY -= 20;

  // --- REGISTRATION ---
  if (lineItems.length === 1) {
    const single = lineItems[0];
    const isAcc = single.category === 'Accommodation';
    drawSectionTitle(isAcc ? 'ACCOMMODATION BOOKING' : 'REGISTRATION');
    drawRow(isAcc ? 'Booking' : 'Event Name', single.eventName, helveticaBold, 11);
    if (single.category) {
      drawRow('Category', single.category);
    }
    if (!isAcc) {
      drawRow('Registration Type', single.registrationType === 'team' ? 'Team' : 'Individual');
      if (single.registrationType === 'team' && single.teamName) {
        drawRow('Team', single.teamName);
      }
    }
  } else {
    const hasAcc = lineItems.some(i => i.category === 'Accommodation');
    drawSectionTitle(hasAcc ? `REGISTRATION & ITEMS (${lineItems.length} ITEMS)` : `REGISTRATION (${lineItems.length} EVENTS)`);
    lineItems.forEach((item, index) => {
      const isAcc = item.category === 'Accommodation';
      const typeInfo = isAcc
        ? 'Booking'
        : item.registrationType === 'team' && item.teamName
        ? `Team: ${item.teamName}`
        : item.registrationType === 'team' ? 'Team' : 'Individual';
      const categoryInfo = item.category ? ` (${item.category})` : '';
      drawRow(isAcc ? `Item ${index + 1}` : `Event ${index + 1}`, `${item.eventName}${categoryInfo} — ${typeInfo}`);
    });
  }

  cursorY -= 12;
  drawDivider(currentPage, cursorY);
  cursorY -= 20;

  // --- TEAM MEMBERS (Only if team registration with members) ---
  if (data.teamMembers && data.teamMembers.length > 0) {
    drawSectionTitle(`TEAM MEMBERS (${data.teamMembers.length} MEMBERS)`);

    data.teamMembers.forEach((member, idx) => {
      const memberLinesCount = 3 + (member.phone ? 1 : 0);
      const memberHeight = memberLinesCount * 14 + 18;
      checkPageOverflow(memberHeight);

      const numStr = String(idx + 1).padStart(2, '0');
      const roleStr = member.role || (member.isTeamLeader ? 'Team Head' : 'Team Member');

      currentPage.drawText(`${numStr}  ${member.name.toUpperCase()}`, {
        x: MARGIN,
        y: cursorY,
        size: 10,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1),
      });

      currentPage.drawText(roleStr, {
        x: PAGE_WIDTH - MARGIN - 100,
        y: cursorY,
        size: 9,
        font: helveticaBold,
        color: member.isTeamLeader ? rgb(0.45, 0.1, 0.75) : rgb(0.4, 0.4, 0.4),
      });

      cursorY -= 14;

      const detailX = MARGIN + 20;

      // Participant ID
      currentPage.drawText('Participant ID:', {
        x: detailX,
        y: cursorY,
        size: 8.5,
        font: helvetica,
        color: rgb(0.45, 0.45, 0.45),
      });
      currentPage.drawText(member.participantId, {
        x: detailX + 90,
        y: cursorY,
        size: 8.5,
        font: helveticaBold,
        color: rgb(0.15, 0.15, 0.15),
      });
      cursorY -= 12;

      // Email
      if (member.email) {
        currentPage.drawText('Email:', {
          x: detailX,
          y: cursorY,
          size: 8.5,
          font: helvetica,
          color: rgb(0.45, 0.45, 0.45),
        });
        currentPage.drawText(member.email, {
          x: detailX + 90,
          y: cursorY,
          size: 8.5,
          font: helvetica,
          color: rgb(0.15, 0.15, 0.15),
        });
        cursorY -= 12;
      }

      // Contact
      if (member.phone) {
        currentPage.drawText('Contact:', {
          x: detailX,
          y: cursorY,
          size: 8.5,
          font: helvetica,
          color: rgb(0.45, 0.45, 0.45),
        });
        currentPage.drawText(member.phone, {
          x: detailX + 90,
          y: cursorY,
          size: 8.5,
          font: helvetica,
          color: rgb(0.15, 0.15, 0.15),
        });
        cursorY -= 12;
      }

      cursorY -= 6;
    });

    cursorY -= 6;
    drawDivider(currentPage, cursorY);
    cursorY -= 20;
  }

  // --- PAYMENT DETAILS ---
  drawSectionTitle('PAYMENT DETAILS');
  drawRow('Status', 'PAID', helveticaBold, 10);
  drawRow('Gateway', data.gateway);
  drawRow('Order ID', data.gatewayOrderId);
  drawRow('Payment ID', data.gatewayPaymentId);
  drawRow('Payment Date', data.paymentDate);

  cursorY -= 12;
  drawDivider(currentPage, cursorY);
  cursorY -= 25;

  // --- PAYMENT SUMMARY ---
  drawSectionTitle('PAYMENT SUMMARY');
  
  checkPageOverflow(50);

  // Table header
  currentPage.drawText('Description', {
    x: MARGIN,
    y: cursorY,
    size: 10,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  currentPage.drawText('Amount', {
    x: PAGE_WIDTH - MARGIN - 70,
    y: cursorY,
    size: 10,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  cursorY -= 20;

  // Table rows for all line items
  for (const item of lineItems) {
    checkPageOverflow(25);
    const itemDesc = `${item.eventName} Registration`;
    const descLines = wrapText(itemDesc, helvetica, 10, CONTENT_WIDTH - 100);

    currentPage.drawText(descLines[0] || itemDesc, {
      x: MARGIN,
      y: cursorY,
      size: 10,
      font: helvetica,
      color: rgb(0.2, 0.2, 0.2),
    });
    currentPage.drawText(`INR ${item.amount}`, {
      x: PAGE_WIDTH - MARGIN - 70,
      y: cursorY,
      size: 10,
      font: helvetica,
      color: rgb(0.2, 0.2, 0.2),
    });
    cursorY -= 16;
  }
  
  cursorY -= 5;
  drawDivider(currentPage, cursorY);
  cursorY -= 15;

  checkPageOverflow(30);

  // TOTAL
  currentPage.drawText('TOTAL PAID', {
    x: MARGIN,
    y: cursorY,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  currentPage.drawText(`INR ${data.amount}`, {
    x: PAGE_WIDTH - MARGIN - 70,
    y: cursorY,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  // --- FOOTER ---
  console.log(`[PDF] TOTAL PAID rendered at ${cursorY}`);
  checkPageOverflow(70);
  const footerY = Math.min(80, cursorY - 35);
  console.log(`[PDF] Footer starts at ${footerY}`);
  drawDivider(currentPage, footerY + 20);
  
  currentPage.drawText('Saviskar 2026', {
    x: MARGIN,
    y: footerY,
    size: 9,
    font: helveticaBold,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  currentPage.drawText('This is an electronically generated payment receipt for Saviskar 2026 registration.', {
    x: MARGIN,
    y: footerY - 15,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });
  
  currentPage.drawText('No physical signature is required.', {
    x: MARGIN,
    y: footerY - 28,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // --- PAGE LABELS (Second Pass across all pages: Page X of N) ---
  const totalPages = pdfDoc.getPageCount();
  const pages = pdfDoc.getPages();
  const pageLabelFontSize = 8;
  const pageLabelY = 35; // Positioned in bottom margin area, well below any content and legal notices

  pages.forEach((page, index) => {
    const pageNum = index + 1;
    const label = `Page ${pageNum} of ${totalPages}`;
    const labelWidth = helvetica.widthOfTextAtSize(label, pageLabelFontSize);
    const labelX = PAGE_WIDTH - MARGIN - labelWidth;

    page.drawText(label, {
      x: labelX,
      y: pageLabelY,
      size: pageLabelFontSize,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5),
    });
  });

  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
