import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  INVITATION_EMAIL_SUBJECT,
  CANONICAL_SITE_URL,
  DEFAULT_EXPIRY_HOURS,
  escapeHtml,
  renderInvitationEmailHtml,
  renderInvitationEmailText,
  getSupabaseInviteTemplateHtml,
  getSupabaseInviteTemplateText,
} from "@/lib/auth/invitation-template";

describe("Admin Invitation Email Template & Deliverability", () => {
  const mockConfirmationUrl =
    "https://auth.saviskar.co.in/auth/v1/verify?token=pkce_secret_token_abc123&type=invite&redirect_to=https%3A%2F%2Fsaviskar.co.in%2Fadmin%2Faccept-invite";
  const mockEmail = "newadmin@saviskar.co.in";

  it("1. Provides the exact required subject line", () => {
    expect(INVITATION_EMAIL_SUBJECT).toBe("You're invited to Saviskar 2026");
  });

  it("2. Renders a professionally branded HTML template matching Saviskar design system", () => {
    const html = renderInvitationEmailHtml({
      confirmationUrl: mockConfirmationUrl,
      recipientEmail: mockEmail,
      siteUrl: CANONICAL_SITE_URL,
      expiryHours: DEFAULT_EXPIRY_HOURS,
    });

    // Subject & Branding
    expect(html).toContain("SAVISKAR 2026 // AEVORIAN REVERIE");
    expect(html).toContain("You're invited to Saviskar 2026");

    // Body text requirement
    expect(html).toContain(
      "You have been invited to create your Saviskar 2026 administrator account. Accept the invitation below to securely set up your account."
    );

    // Dark theme color tokens
    expect(html).toContain("#050508"); // Outer deep dark background
    expect(html).toContain("#c084fc"); // Accent purple text
    expect(html).toContain("rgba(168, 85, 247"); // Purple border/glow

    // Primary CTA button
    expect(html).toContain(">Accept Invitation<");
    expect(html).toContain(`href="${escapeHtml(mockConfirmationUrl)}"`);
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("rel=\"noopener noreferrer\"");

    // Direct link fallback
    expect(html).toContain("If the button above does not work, copy and paste this link");

    // Supporting security & expiration text
    expect(html).toContain(mockEmail);
    expect(html).toContain("This secure link is single-use and expires in");
    expect(html).toContain("24 hours");
    expect(html).toContain("If you were not expecting an administrator invitation for Saviskar 2026, you can safely ignore this email.");

    // Official website and organization attribution
    expect(html).toContain("saviskar.co.in");
    expect(html).toContain("CGC University, Mohali • Student Advisory Council (SAC)");
    expect(html).toContain("© 2026 CGC Saviskar");
  });

  it("3. Generates a matching plain-text alternative", () => {
    const text = renderInvitationEmailText({
      confirmationUrl: mockConfirmationUrl,
      recipientEmail: mockEmail,
      siteUrl: CANONICAL_SITE_URL,
      expiryHours: 24,
    });

    expect(text).toContain("SAVISKAR 2026 // AEVORIAN REVERIE");
    expect(text).toContain("You're invited to Saviskar 2026");
    expect(text).toContain("You have been invited to create your Saviskar 2026 administrator account.");
    expect(text).toContain(mockConfirmationUrl);
    expect(text).toContain(mockEmail);
    expect(text).toContain("expires in 24 hours");
    expect(text).toContain("https://saviskar.co.in");
    expect(text).toContain("CGC University, Mohali • Student Advisory Council (SAC)");
  });

  it("4. Prevents HTML injection in recipient email and user-controlled strings", () => {
    const maliciousEmail = '"><script>alert("xss")</script><b class="bad';
    const escaped = escapeHtml(maliciousEmail);

    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&quot;");

    const html = renderInvitationEmailHtml({
      confirmationUrl: mockConfirmationUrl,
      recipientEmail: maliciousEmail,
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("5. Outputs valid Supabase Go-template placeholders for dashboard / CLI usage", () => {
    const supabaseHtml = getSupabaseInviteTemplateHtml();
    const supabaseText = getSupabaseInviteTemplateText();

    expect(supabaseHtml).toContain("{{ .ConfirmationURL }}");
    expect(supabaseHtml).toContain("{{ .Email }}");
    expect(supabaseHtml).toContain("{{ .SiteURL }}");
    expect(supabaseHtml).toContain("Accept Invitation");

    expect(supabaseText).toContain("{{ .ConfirmationURL }}");
    expect(supabaseText).toContain("{{ .Email }}");
  });

  it("6. Verifies physical supabase/templates/invite.html exists and is valid", () => {
    const templatePath = path.join(process.cwd(), "supabase", "templates", "invite.html");
    expect(fs.existsSync(templatePath)).toBe(true);

    const content = fs.readFileSync(templatePath, "utf8");
    expect(content.length).toBeGreaterThan(1000);
    expect(content).toContain("{{ .ConfirmationURL }}");
    expect(content).toContain("Accept Invitation");
    expect(content).toContain("SAVISKAR 2026 // AEVORIAN REVERIE");
  });

  it("7. Verifies supabase/config.toml registers the invite email template", () => {
    const configPath = path.join(process.cwd(), "supabase", "config.toml");
    expect(fs.existsSync(configPath)).toBe(true);

    const configContent = fs.readFileSync(configPath, "utf8");
    expect(configContent).toContain("[auth.email.template.invite]");
    expect(configContent).toContain('subject = "You\'re invited to Saviskar 2026"');
    expect(configContent).toContain('content_path = "./supabase/templates/invite.html"');
  });

  it("8. Protects against secret / token logging", () => {
    // Verify that the template functions do not log tokens or secrets to console
    const consoleSpy = vi.spyOn(console, "log");
    renderInvitationEmailHtml({
      confirmationUrl: "https://auth.saviskar.co.in/verify?secret_token=super_secret_12345",
      recipientEmail: "test@example.com",
    });
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("super_secret_12345"));
    consoleSpy.mockRestore();
  });
});
