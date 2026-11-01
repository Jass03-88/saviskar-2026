/**
 * SAVISKAR 2026 — Premium Participation Certificate Email Template
 *
 * Designed to represent CGC University and Saviskar 2026 with high prestige:
 * - Signature cyan-purple-pink gradient:
 *     background: #00b7ff;
 *     background: linear-gradient(90deg, rgba(0, 183, 255, 1) 0%, rgba(136, 87, 199, 1) 50%, rgba(237, 83, 109, 1) 100%);
 * - Solid #00b7ff fallback for legacy email clients (Outlook, Windows Mail)
 * - Premium white central card (#ffffff) with subtle border & elevation
 * - Responsive table-based layout with inline styles & media queries
 * - Prominent PDF attachment callout card
 * - Official CGC University & Saviskar 2026 branding
 * - Official social links and channels extracted from components/ui/Footer.tsx
 * - Official closing tagline: "A Festival of Ideas, People and Possibilities."
 */

export const CERTIFICATE_EMAIL_SUBJECT =
  "Your Official Certificate of Participation | Saviskar 2026";

export const CERTIFICATE_CAMPAIGN_DEFAULT_TITLE =
  "Saviskar 2026 Participation Certificates";

export const DEFAULT_CERTIFICATE_LOGO_URL =
  "https://saviskar.co.in/images/saviskar-official-logo.png";

export const SAVISKAR_OFFICIAL_URLS = {
  website: "https://saviskar.co.in",
  instagram: "https://www.instagram.com/saviskar.cgcuniversity/",
  youtube: "https://www.youtube.com/@SaviskarCGCU",
  email: "saviskar@cgcuniversity.in",
  events: "https://saviskar.co.in/events",
  schedule: "https://saviskar.co.in/schedule",
  gallery: "https://saviskar.co.in/gallery",
};

export const SAVISKAR_OFFICIAL_ADDRESS = {
  institution: "CGC University, Mohali",
  addressLine:
    "State Highway 12A, Chandigarh-Sirhind Road, Sahibzada Ajit Singh Nagar, Punjab 140307",
  copyright: "© 2026 SAVISKAR • CGC UNIVERSITY MOHALI • ALL RIGHTS RESERVED",
  tagline: "A Festival of Ideas, People and Possibilities.",
  theme: "Aevorian Reverie",
};

export interface CertificateEmailOptions {
  recipientName?: string;
  eventName?: string;
  certificateNumber?: string;
  isStayOnly?: boolean;
  teamName?: string;
  isTeamLeader?: boolean;
  totalCertificatesAttached?: number;
  attachmentFilename?: string;
  previewText?: string;
  logoUrl?: string;
}

export interface CertificateTeamBackupEmailOptions {
  teamName: string;
  leaderName?: string;
  partNumber?: number;
  totalParts?: number;
  logoUrl?: string;
  members: Array<{
    recipientName: string;
    eventName: string;
    certificateNumber?: string;
  }>;
}

/**
 * Escapes HTML characters to prevent injection attacks while rendering recipient data.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Formats clean filenames for the attachment card display.
 */
export function sanitizeAttachmentDisplayName(
  eventName?: string,
  recipientName?: string
): string {
  const safeEvent = (eventName || "Participation")
    .replace(/[^a-zA-Z0-9\s-_]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return `Saviskar_Certificate_${safeEvent}.pdf`;
}

/**
 * Renders the premium HTML email for individual participant certificates.
 */
export function renderCertificateEmailHtml(options?: CertificateEmailOptions): string {
  const rawName = options?.recipientName?.trim();
  const safeRecipientName = rawName ? escapeHtml(rawName) : "Participant";
  const eventName = options?.eventName?.trim();
  const safeEventName = eventName ? escapeHtml(eventName) : null;
  const safeCertNumber = options?.certificateNumber?.trim()
    ? escapeHtml(options.certificateNumber.trim())
    : null;
  const isStayOnly = Boolean(options?.isStayOnly);

  const rawLogoUrl = options?.logoUrl?.trim() || DEFAULT_CERTIFICATE_LOGO_URL;
  const safeLogoUrl = escapeHtml(rawLogoUrl);

  const filename =
    options?.attachmentFilename ||
    sanitizeAttachmentDisplayName(eventName, rawName);
  const safeFilename = escapeHtml(filename);

  const preheaderText = safeEventName
    ? `Your official Certificate of Participation for ${safeEventName} at Saviskar 2026, CGC University Mohali is attached.`
    : "Your official Certificate of Participation for Saviskar 2026, CGC University Mohali is attached.";

  // Event Context Paragraph
  let participationContextHtml = "";
  if (isStayOnly) {
    participationContextHtml = `
      We are delighted to present your official <strong>Certificate of Participation</strong> in recognition of your presence, enthusiasm, and engagement as a delegate at <strong>Saviskar 2026</strong>.
    `;
  } else if (safeEventName) {
    participationContextHtml = `
      We are pleased to present your official <strong>Certificate of Participation</strong> in recognition of your outstanding effort and engagement in <strong>${safeEventName}</strong>.
    `;
  } else {
    participationContextHtml = `
      We are pleased to present your official <strong>Certificate of Participation</strong> in recognition of your active presence and engagement at <strong>Saviskar 2026</strong>.
    `;
  }

  // Certificate ID callout block if available
  const certIdBadgeHtml = safeCertNumber
    ? `
      <div style="margin-top: 18px; display: inline-block; padding: 6px 14px; background-color: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; font-family: 'Courier New', Courier, monospace; font-size: 12px; font-weight: bold; color: #374151; letter-spacing: 0.5px;">
        CERTIFICATE ID: <span style="color: #6366f1;">${safeCertNumber}</span>
      </div>
    `
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(CERTIFICATE_EMAIL_SUBJECT)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Client resets */
    html, body {
      margin: 0 auto !important;
      padding: 0 !important;
      height: 100% !important;
      width: 100% !important;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt !important;
      mso-table-rspace: 0pt !important;
      border-collapse: collapse !important;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      outline: none;
      text-decoration: none;
    }
    /* Mobile responsive overrides */
    @media only screen and (max-width: 620px) {
      .email-container {
        width: 100% !important;
        max-width: 100% !important;
      }
      .content-padding {
        padding: 24px 20px !important;
      }
      .header-padding {
        padding: 32px 20px 28px 20px !important;
      }
      .email-header-logo {
        width: 250px !important;
        height: auto !important;
      }
      .attachment-box {
        padding: 16px !important;
      }
      .social-link-item {
        display: inline-block !important;
        margin: 4px 6px !important;
      }
      .footer-padding {
        padding: 24px 16px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; -webkit-font-smoothing: antialiased;">

  <!-- Preheader text (Hidden in email body, visible in inbox summary) -->
  <div style="display: none; font-size: 1px; color: #f4f5f8; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${escapeHtml(preheaderText)}
    &#847; &zwnj; &nbsp; &#8199; &shy; &#847; &zwnj; &nbsp; &#8199; &shy; &#847; &zwnj; &nbsp; &#8199; &shy;
  </div>

  <!-- Outer Full-Width Table Wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f5f8" style="background-color: #f4f5f8; margin: 0; padding: 36px 12px; width: 100%;">
    <tr>
      <td align="center" valign="top">
        <!--[if (gte mso 9)|(IE)]>
        <table role="presentation" width="620" align="center" cellpadding="0" cellspacing="0" border="0">
        <tr>
        <td>
        <![endif]-->

        <!-- Main Email Container (Central Card) -->
        <table role="presentation" class="email-container" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06); border: 1px solid #e5e7eb;">

          <!-- GRADIENT HERO HEADER -->
          <tr>
            <td class="header-padding" align="center" bgcolor="#00b7ff" style="background-color: #00b7ff; background: #00b7ff; background: linear-gradient(90deg, rgba(0, 183, 255, 1) 0%, rgba(136, 87, 199, 1) 50%, rgba(237, 83, 109, 1) 100%); padding: 42px 32px 36px 32px; text-align: center;">

              <!-- Sub-header Pill / Badge -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                <tr>
                  <td style="background-color: rgba(255, 255, 255, 0.22); border-radius: 9999px; padding: 6px 16px; border: 1px solid rgba(255, 255, 255, 0.35);">
                    <span style="font-size: 11px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.15);">
                      CGC UNIVERSITY, MOHALI
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Official Saviskar 2026 Logo (PNG) -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 20px auto 14px auto;">
                <tr>
                  <td align="center" valign="middle">
                    <img
                      src="${safeLogoUrl}"
                      alt="SAVISKAR 2026 official logo"
                      width="320"
                      height="68"
                      class="email-header-logo"
                      style="display: block; width: 320px; max-width: 100%; height: auto; margin: 0 auto; border: 0; outline: none; text-decoration: none;"
                    />
                  </td>
                </tr>
              </table>

              <!-- Document Type Heading -->
              <p style="margin: 0; font-size: 15px; font-weight: 700; color: #ffffff; letter-spacing: 1.5px; text-transform: uppercase; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);">
                Official Certificate of Participation
              </p>

              <!-- Subtle Theme Subtext -->
              <p style="margin: 6px 0 0 0; font-size: 12px; font-style: italic; color: rgba(255, 255, 255, 0.85); letter-spacing: 0.5px;">
                Where Tomorrow Dreams Awake • Theme: Aevorian Reverie
              </p>
            </td>
          </tr>

          <!-- CENTRAL CARD BODY -->
          <tr>
            <td class="content-padding" style="padding: 38px 36px; background-color: #ffffff; text-align: left;">

              <!-- Personalized Greeting -->
              <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.3px;">
                Dear ${safeRecipientName},
              </h2>

              <!-- Congratulatory Opening -->
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.65; color: #374151;">
                Congratulations on your participation in <strong>Saviskar 2026</strong>, North India&apos;s flagship Annual National Techno-Cultural University Festival held at <strong>CGC University, Mohali</strong>.
              </p>

              <!-- Event Context -->
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.65; color: #374151;">
                ${participationContextHtml}
              </p>

              <!-- Official Verification Callout -->
              <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #4b5563; background-color: #f9fafb; border-left: 3px solid #00b7ff; padding: 12px 16px; border-radius: 0 8px 8px 0;">
                This certificate has been officially verified and permanently recorded under CGC University records, honoring your dedication to innovation, talent, and excellence.
                ${certIdBadgeHtml}
              </p>

              <!-- CERTIFICATE ATTACHMENT SECTION (Visually Rich Card) -->
              <table role="presentation" class="attachment-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 26px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; border-left: 4px solid #8857c7;">
                <tr>
                  <td style="padding: 20px 22px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <!-- PDF Graphic Badge -->
                        <td width="48" valign="top" style="padding-right: 16px;">
                          <div style="width: 44px; height: 52px; background-color: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; text-align: center; line-height: 52px; box-shadow: 0 2px 6px rgba(239, 68, 68, 0.15);">
                            <span style="font-family: Arial, sans-serif; font-size: 12px; font-weight: 900; color: #dc2626; letter-spacing: 0.5px;">
                              PDF
                            </span>
                          </div>
                        </td>
                        <!-- Attachment Meta and Details -->
                        <td valign="middle" align="left">
                          <div style="font-size: 11px; font-weight: 700; color: #8857c7; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px;">
                            ATTACHED VERIFIED DOCUMENT
                          </div>
                          <div style="font-size: 15px; font-weight: 700; color: #0f172a; word-break: break-all; line-height: 1.3;">
                            ${safeFilename}
                          </div>
                          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                            Official High-Resolution PDF &bull; Print &amp; Portfolio Ready
                          </div>
                        </td>
                      </tr>
                    </table>

                    <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #edf2f7; font-size: 13px; line-height: 1.5; color: #475569;">
                      <strong>Action:</strong> Your verified certificate is attached to this email as a PDF document. You can download, print, or share it directly to your academic portfolio and LinkedIn profile.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Closing Note -->
              <p style="margin: 0 0 26px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                We applaud your spirit, creativity, and enthusiasm, which brought immense vibrancy to the celebrations at CGC University. We wish you continued success in all your future academic and professional endeavors.
              </p>

              <!-- OFFICIAL SIGNATURE BLOCK -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 28px; padding-top: 22px; border-top: 1px solid #e5e7eb;">
                <tr>
                  <td valign="top" align="left">
                    <div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                      Warm regards,
                    </div>
                    <div style="font-size: 16px; font-weight: 700; color: #111827; letter-spacing: -0.2px;">
                      Organizing Committee, Saviskar 2026
                    </div>
                    <div style="font-size: 13px; font-weight: 500; color: #4b5563; margin-top: 2px;">
                      CGC University, Mohali
                    </div>
                  </td>
                  <td valign="middle" align="right">
                    <!-- Stylized Crest / Seal -->
                    <div style="display: inline-block; padding: 6px 12px; background-color: #f3f4f6; border-radius: 9999px; font-size: 11px; font-weight: 700; color: #4b5563; letter-spacing: 1px; text-transform: uppercase;">
                      OFFICIAL &bull; VERIFIED
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- INSPIRATIONAL FESTIVAL TAGLINE BAR -->
          <tr>
            <td bgcolor="#faf5ff" align="center" style="background-color: #faf5ff; border-top: 1px solid #f3e8ff; border-bottom: 1px solid #f3e8ff; padding: 16px 24px; text-align: center;">
              <p style="margin: 0; font-size: 13px; font-style: italic; font-weight: 600; color: #6b21a8; letter-spacing: 0.5px;">
                &ldquo;${SAVISKAR_OFFICIAL_ADDRESS.tagline}&rdquo;
              </p>
            </td>
          </tr>

          <!-- SOCIAL CHANNELS & QUICK ACCESS ROW -->
          <tr>
            <td class="content-padding" bgcolor="#0f172a" align="center" style="background-color: #0f172a; padding: 28px 24px; text-align: center;">

              <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
                CONNECT WITH SAVISKAR &amp; CGC UNIVERSITY
              </div>

              <!-- Button / Link Row -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                <tr>
                  <!-- Instagram -->
                  <td class="social-link-item" style="padding: 0 8px;">
                    <a href="${SAVISKAR_OFFICIAL_URLS.instagram}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 16px; background-color: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 8px; font-size: 12px; font-weight: 600; color: #f1f5f9; text-decoration: none; transition: all 0.2s;">
                      Instagram &rarr;
                    </a>
                  </td>

                  <!-- YouTube -->
                  <td class="social-link-item" style="padding: 0 8px;">
                    <a href="${SAVISKAR_OFFICIAL_URLS.youtube}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 16px; background-color: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 8px; font-size: 12px; font-weight: 600; color: #f1f5f9; text-decoration: none; transition: all 0.2s;">
                      YouTube &rarr;
                    </a>
                  </td>

                  <!-- Website -->
                  <td class="social-link-item" style="padding: 0 8px;">
                    <a href="${SAVISKAR_OFFICIAL_URLS.website}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 16px; background-color: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 8px; font-size: 12px; font-weight: 600; color: #f1f5f9; text-decoration: none; transition: all 0.2s;">
                      Official Portal &rarr;
                    </a>
                  </td>

                  <!-- Contact Support -->
                  <td class="social-link-item" style="padding: 0 8px;">
                    <a href="mailto:${SAVISKAR_OFFICIAL_URLS.email}" style="display: inline-block; padding: 8px 16px; background-color: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 8px; font-size: 12px; font-weight: 600; color: #f1f5f9; text-decoration: none; transition: all 0.2s;">
                      Contact Desk &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- OFFICIAL FOOTER & LEGAL NOTICE -->
          <tr>
            <td class="footer-padding" bgcolor="#090d16" style="background-color: #090d16; padding: 26px 30px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.08);">

              <!-- Address Details -->
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #cbd5e1; letter-spacing: 0.5px;">
                ${SAVISKAR_OFFICIAL_ADDRESS.institution}
              </p>
              <p style="margin: 0 0 14px 0; font-size: 11px; line-height: 1.5; color: #94a3b8;">
                ${SAVISKAR_OFFICIAL_ADDRESS.addressLine}
              </p>

              <!-- Transactional Notice -->
              <p style="margin: 0 0 12px 0; font-size: 10px; line-height: 1.5; color: #64748b; max-width: 520px; margin-left: auto; margin-right: auto;">
                This is an official transactional notification issued directly to registered participants of Saviskar 2026. You are receiving this because you participated in an event or campus delegation at CGC University, Mohali.
              </p>

              <!-- Copyright -->
              <p style="margin: 0; font-size: 10px; font-weight: 700; color: #475569; letter-spacing: 1px; text-transform: uppercase;">
                ${SAVISKAR_OFFICIAL_ADDRESS.copyright}
              </p>

            </td>
          </tr>

        </table>
        <!-- End Main Email Container -->

        <!--[if (gte mso 9)|(IE)]>
        </td>
        </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Renders the clean plain-text alternative of the participant certificate email.
 */
export function renderCertificateEmailText(options?: CertificateEmailOptions): string {
  const recipientName = options?.recipientName?.trim() || "Participant";
  const eventName = options?.eventName?.trim();
  const certNumber = options?.certificateNumber?.trim();
  const isStayOnly = Boolean(options?.isStayOnly);

  const filename =
    options?.attachmentFilename ||
    sanitizeAttachmentDisplayName(eventName, recipientName);

  let eventParagraph = "";
  if (isStayOnly) {
    eventParagraph =
      "We are delighted to present your official Certificate of Participation in recognition of your presence, enthusiasm, and engagement as a delegate at Saviskar 2026.";
  } else if (eventName) {
    eventParagraph = `We are pleased to present your official Certificate of Participation in recognition of your outstanding effort and engagement in ${eventName}.`;
  } else {
    eventParagraph =
      "We are pleased to present your official Certificate of Participation in recognition of your active presence and engagement at Saviskar 2026.";
  }

  const certNumberLine = certNumber ? `\nCERTIFICATE ID: ${certNumber}\n` : "";

  return `Dear ${recipientName},

Congratulations on your participation in Saviskar 2026, North India's flagship Annual National Techno-Cultural University Festival held at CGC University, Mohali.

${eventParagraph}

This certificate has been officially verified and permanently recorded under CGC University records, honoring your dedication to innovation, talent, and excellence.
${certNumberLine}
--------------------------------------------------------------------------------
ATTACHED OFFICIAL DOCUMENT:
File: ${filename}
Type: Official High-Resolution PDF (Print & Portfolio Ready)

ACTION:
Your verified certificate is attached to this email as a PDF document. You can download, print, or share it directly to your academic portfolio and LinkedIn profile.
--------------------------------------------------------------------------------

We applaud your spirit, creativity, and enthusiasm, which brought immense vibrancy to the celebrations at CGC University. We wish you continued success in all your future academic and professional endeavors.

Warm regards,

Organizing Committee, Saviskar 2026
CGC University, Mohali

"A Festival of Ideas, People and Possibilities."

--------------------------------------------------------------------------------
OFFICIAL LINKS & CHANNELS:
Official Website: ${SAVISKAR_OFFICIAL_URLS.website}
Instagram: ${SAVISKAR_OFFICIAL_URLS.instagram}
YouTube: ${SAVISKAR_OFFICIAL_URLS.youtube}
Help & Contact: ${SAVISKAR_OFFICIAL_URLS.email}

VENUE:
${SAVISKAR_OFFICIAL_ADDRESS.institution}
${SAVISKAR_OFFICIAL_ADDRESS.addressLine}

${SAVISKAR_OFFICIAL_ADDRESS.copyright}
This is an official transactional notification sent to registered participants of Saviskar 2026.
`;
}

/**
 * Renders the premium HTML email for Team Leader Backup deliveries (chunked team certificates).
 */
export function renderCertificateTeamBackupEmailHtml(
  options: CertificateTeamBackupEmailOptions
): string {
  const safeTeamName = escapeHtml(options.teamName || "Team");
  const safeLeaderName = options.leaderName
    ? escapeHtml(options.leaderName)
    : "Team Leader";
  const partNumber = options.partNumber || 1;
  const totalParts = options.totalParts || 1;
  const memberCount = options.members?.length || 0;

  const partHeader =
    totalParts > 1 ? ` &bull; Part ${partNumber} of ${totalParts}` : "";

  const rawLogoUrl = options.logoUrl?.trim() || DEFAULT_CERTIFICATE_LOGO_URL;
  const safeLogoUrl = escapeHtml(rawLogoUrl);

  const memberRowsHtml = (options.members || [])
    .map(
      (m, idx) => `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 12px; font-size: 13px; color: #1e293b; font-weight: 600;">
          ${idx + 1}. ${escapeHtml(m.recipientName)}
        </td>
        <td style="padding: 10px 12px; font-size: 12px; color: #64748b;">
          ${escapeHtml(m.eventName)}
        </td>
        <td style="padding: 10px 12px; font-size: 11px; font-family: monospace; color: #6366f1; text-align: right;">
          ${escapeHtml(m.certificateNumber || "SAV26-VERIFIED")}
        </td>
      </tr>
    `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Team Certificates | Saviskar 2026</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f5f8" style="background-color: #f4f5f8; margin: 0; padding: 36px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06); border: 1px solid #e5e7eb;">

          <!-- GRADIENT HEADER -->
          <tr>
            <td bgcolor="#00b7ff" style="background-color: #00b7ff; background: #00b7ff; background: linear-gradient(90deg, rgba(0, 183, 255, 1) 0%, rgba(136, 87, 199, 1) 50%, rgba(237, 83, 109, 1) 100%); padding: 36px 32px; text-align: center;">
              <div style="font-size: 11px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 2px;">
                CGC UNIVERSITY, MOHALI
              </div>

              <!-- Official Saviskar 2026 Logo (PNG) -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 18px auto 12px auto;">
                <tr>
                  <td align="center" valign="middle">
                    <img
                      src="${safeLogoUrl}"
                      alt="SAVISKAR 2026 official logo"
                      width="280"
                      height="60"
                      class="email-header-logo"
                      style="display: block; width: 280px; max-width: 100%; height: auto; margin: 0 auto; border: 0; outline: none; text-decoration: none;"
                    />
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 14px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 1px; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);">
                Official Team Certificates Manifest${partHeader}
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding: 36px 32px; background-color: #ffffff;">
              <h2 style="margin: 0 0 14px 0; font-size: 20px; font-weight: 700; color: #111827;">
                Dear ${safeLeaderName} (${safeTeamName}),
              </h2>

              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #374151;">
                This backup package contains <strong>${memberCount} official Certificates of Participation</strong> for members of team <strong>${safeTeamName}</strong> at Saviskar 2026, CGC University Mohali.
              </p>

              <!-- Roster Manifest Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                    <th align="left" style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Member Name</th>
                    <th align="left" style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Event</th>
                    <th align="right" style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Certificate ID</th>
                  </tr>
                </thead>
                <tbody>
                  ${memberRowsHtml}
                </tbody>
              </table>

              <div style="background-color: #f8fafc; border-left: 4px solid #8857c7; padding: 14px 18px; border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.5; color: #475569;">
                <strong>Attached Files:</strong> Each team member&apos;s verified PDF certificate is attached to this email. As team leader, please ensure any member without an active email receives their official copy.
              </div>

              <!-- SIGNATURE -->
              <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <div style="font-size: 15px; font-weight: 700; color: #111827;">
                  Organizing Committee, Saviskar 2026
                </div>
                <div style="font-size: 13px; color: #6b7280;">
                  CGC University, Mohali
                </div>
              </div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td bgcolor="#090d16" style="background-color: #090d16; padding: 22px; text-align: center; color: #94a3b8; font-size: 11px;">
              ${SAVISKAR_OFFICIAL_ADDRESS.institution} &bull; ${SAVISKAR_OFFICIAL_ADDRESS.copyright}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
