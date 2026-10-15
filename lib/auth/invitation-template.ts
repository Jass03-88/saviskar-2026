/**
 * Saviskar 2026 - Admin Invitation Email Template Generator
 *
 * Provides professionally branded, dark-themed HTML and plain-text templates
 * for Saviskar 2026 administrator invitations.
 *
 * Design matches the Saviskar design system:
 * - Deep dark background (#050508)
 * - Glassmorphic dark card (#0f0f16) with subtle purple border (#a855f7 / rgba(168, 85, 247, 0.35))
 * - Monospace brand pill badge: "SAVISKAR 2026 // AEVORIAN REVERIE"
 * - High-contrast typography with clear hierarchy
 * - Prominent "Accept Invitation" CTA button
 * - Security disclaimers, recipient notice, 24-hour expiration notice, and official site footer
 */

export const INVITATION_EMAIL_SUBJECT = "You're invited to Saviskar 2026";
export const CANONICAL_SITE_URL = "https://saviskar.co.in";
export const DEFAULT_EXPIRY_HOURS = 24;

/**
 * Escapes user-controlled strings to prevent HTML injection.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface InvitationEmailOptions {
  confirmationUrl: string;
  recipientEmail?: string;
  siteUrl?: string;
  expiryHours?: number;
}

/**
 * Renders the HTML template for an invitation email.
 * Can be used with runtime values or Supabase template tags.
 */
export function renderInvitationEmailHtml(options: InvitationEmailOptions): string {
  const confirmationUrl = options.confirmationUrl;
  const isSupabaseTag = confirmationUrl.includes("{{");
  const safeConfirmationUrl = isSupabaseTag ? confirmationUrl : escapeHtml(confirmationUrl);

  const recipientEmail = options.recipientEmail ?? "{{ .Email }}";
  const safeRecipientEmail = recipientEmail.includes("{{") ? recipientEmail : escapeHtml(recipientEmail);

  const siteUrl = options.siteUrl ?? CANONICAL_SITE_URL;
  const safeSiteUrl = siteUrl.includes("{{") ? siteUrl : escapeHtml(siteUrl);

  const expiryHours = options.expiryHours ?? DEFAULT_EXPIRY_HOURS;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${INVITATION_EMAIL_SUBJECT}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #050508; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5; -webkit-font-smoothing: antialiased;">
  <!-- Preheader preview text (hidden in body, visible in inbox list) -->
  <div style="display: none; font-size: 1px; color: #050508; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    You have been invited to create your Saviskar 2026 administrator account. Accept the invitation below to securely set up your account.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #050508; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 540px; background-color: #0f0f16; background: linear-gradient(180deg, #14141f 0%, #0c0c14 100%); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 20px; padding: 36px 28px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 35px rgba(168, 85, 247, 0.12);">
          
          <!-- Header Branding Badge -->
          <tr>
            <td align="center" style="padding-bottom: 22px;">
              <div style="display: inline-block; padding: 6px 14px; background-color: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 9999px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 11px; font-weight: 700; color: #c084fc; letter-spacing: 0.18em; text-transform: uppercase;">
                SAVISKAR 2026 // AEVORIAN REVERIE
              </div>
            </td>
          </tr>

          <!-- Primary Heading -->
          <tr>
            <td align="center" style="padding-bottom: 14px;">
              <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em; line-height: 1.25;">
                You're invited to Saviskar 2026
              </h1>
            </td>
          </tr>

          <!-- Body Description -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #d4d4d8; max-width: 440px;">
                You have been invited to create your Saviskar 2026 administrator account. Accept the invitation below to securely set up your account.
              </p>
            </td>
          </tr>

          <!-- Primary Call to Action Button -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 12px; background-color: #8b5cf6; background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); box-shadow: 0 10px 25px rgba(124, 58, 237, 0.4);">
                    <a href="${safeConfirmationUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 34px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff !important; text-decoration: none; border-radius: 12px; border: 1px solid rgba(216, 180, 254, 0.35); text-align: center; mso-padding-alt: 0;">
                      <!--[if mso]><i style="letter-spacing: 34px; mso-font-width: -100%; mso-text-raise: 30pt">&nbsp;</i><![endif]-->
                      <span style="mso-text-raise: 15pt;">Accept Invitation</span>
                      <!--[if mso]><i style="letter-spacing: 34px; mso-font-width: -100%">&nbsp;</i><![endif]-->
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Direct Link Fallback (Usable without images/buttons) -->
          <tr>
            <td style="padding-bottom: 24px;">
              <div style="background-color: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px 16px;">
                <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em;">
                  Direct Activation Link
                </p>
                <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #71717a; word-break: break-all;">
                  If the button above does not work, copy and paste this link into your browser:<br>
                  <a href="${safeConfirmationUrl}" style="color: #c084fc; text-decoration: underline; word-break: break-all; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 11px;">${safeConfirmationUrl}</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Security & Expiration Information -->
          <tr>
            <td style="padding-bottom: 22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: rgba(168, 85, 247, 0.04); border-left: 3px solid #a855f7; border-radius: 4px; padding: 12px 14px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 4px 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                      • This invitation was issued for <strong style="color: #ffffff;">${safeRecipientEmail}</strong>.
                    </p>
                    <p style="margin: 0 0 4px 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                      • This secure link is single-use and expires in <strong style="color: #c084fc;">${expiryHours} hours</strong>.
                    </p>
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #71717a;">
                      • If you were not expecting an administrator invitation for Saviskar 2026, you can safely ignore this email. No administrator account will be created without your explicit activation.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Horizontal Divider -->
          <tr>
            <td style="padding-bottom: 20px;">
              <hr style="border: none; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 0;">
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td align="center">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #a1a1aa;">
                Official Website: <a href="${safeSiteUrl}" target="_blank" rel="noopener noreferrer" style="color: #c084fc; text-decoration: underline;">saviskar.co.in</a>
              </p>
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #71717a;">
                CGC University, Mohali • Student Advisory Council (SAC)
              </p>
              <p style="margin: 0; font-size: 10px; color: #52525b;">
                © 2026 CGC Saviskar. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Renders the plain-text alternative for the invitation email.
 */
export function renderInvitationEmailText(options: InvitationEmailOptions): string {
  const confirmationUrl = options.confirmationUrl;
  const recipientEmail = options.recipientEmail ?? "{{ .Email }}";
  const siteUrl = options.siteUrl ?? CANONICAL_SITE_URL;
  const expiryHours = options.expiryHours ?? DEFAULT_EXPIRY_HOURS;

  return `SAVISKAR 2026 // AEVORIAN REVERIE
=================================

You're invited to Saviskar 2026

You have been invited to create your Saviskar 2026 administrator account. Accept the invitation below to securely set up your account:

Accept Invitation:
${confirmationUrl}

---------------------------------
• This invitation was issued for ${recipientEmail}.
• This secure link is single-use and expires in ${expiryHours} hours.
• If you were not expecting an administrator invitation for Saviskar 2026, you can safely ignore this email. No administrator account will be created without your explicit activation.

Official Website: ${siteUrl}
CGC University, Mohali • Student Advisory Council (SAC)
© 2026 CGC Saviskar. All rights reserved.
`;
}

/**
 * Returns the exact Supabase Auth Invite User HTML template containing Go-template tags:
 * {{ .ConfirmationURL }}, {{ .Email }}, {{ .SiteURL }}
 */
export function getSupabaseInviteTemplateHtml(): string {
  return renderInvitationEmailHtml({
    confirmationUrl: "{{ .ConfirmationURL }}",
    recipientEmail: "{{ .Email }}",
    siteUrl: "{{ .SiteURL }}",
    expiryHours: DEFAULT_EXPIRY_HOURS,
  });
}

/**
 * Returns the exact Supabase Auth Invite User Plain Text template.
 */
export function getSupabaseInviteTemplateText(): string {
  return renderInvitationEmailText({
    confirmationUrl: "{{ .ConfirmationURL }}",
    recipientEmail: "{{ .Email }}",
    siteUrl: "{{ .SiteURL }}",
    expiryHours: DEFAULT_EXPIRY_HOURS,
  });
}
