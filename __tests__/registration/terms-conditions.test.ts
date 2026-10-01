import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";

describe("Saviskar 2K26 Official Terms & Conditions Integration", () => {
  const publicPdfPath = path.resolve(
    process.cwd(),
    "public/SAVISKAR_2K26_Official_Terms_Conditions.pdf"
  );
  const registrationFormPath = path.resolve(
    process.cwd(),
    "components/registration/RegistrationForm.tsx"
  );
  const modalComponentPath = path.resolve(
    process.cwd(),
    "components/registration/TermsConditionsModal.tsx"
  );
  const standaloneTermsPagePath = path.resolve(
    process.cwd(),
    "app/terms/page.tsx"
  );
  const standaloneTermsViewerPath = path.resolve(
    process.cwd(),
    "app/terms/TermsViewerPage.tsx"
  );

  it("1. Verifies the exact PDF filename exists in public directory and has no '_compressed'", () => {
    expect(fs.existsSync(publicPdfPath)).toBe(true);
    expect(path.basename(publicPdfPath)).toBe(
      "SAVISKAR_2K26_Official_Terms_Conditions.pdf"
    );
    expect(path.basename(publicPdfPath)).not.toContain("_compressed");
  });

  it("2. Verifies the PDF contains exactly 7 pages and is valid", async () => {
    const fileBuffer = fs.readFileSync(publicPdfPath);
    expect(fileBuffer.length).toBeGreaterThan(50000);

    const doc = await PDFDocument.load(fileBuffer);
    expect(doc.getPageCount()).toBe(7);
  });

  it("3. Verifies RegistrationForm has the exact updated consent wording and clickable Terms & Conditions link", () => {
    const formContent = fs.readFileSync(registrationFormPath, "utf-8");

    // Must agree to authentic info and Terms & Conditions
    expect(formContent).toContain(
      "I confirm that all delegate information provided above is authentic and I agree to strictly adhere to the official Saviskar 2026"
    );
    expect(formContent).toContain("Terms &amp; Conditions");
    expect(formContent).toContain(
      ", Code of Conduct and applicable event rules."
    );

    // Link must be a button with dialog popup semantics and independent click handling
    expect(formContent).toContain('aria-haspopup="dialog"');
    expect(formContent).toContain('setTermsModalOpen(true)');
    expect(formContent).toContain('e.stopPropagation()');

    // Only one checkbox with name="agreement" and required attribute
    const agreementInputMatches = formContent.match(/name="agreement"/g);
    expect(agreementInputMatches?.length).toBe(1);
    expect(formContent).toContain('required');
  });

  it("4. Verifies TermsConditionsModal has accessible dialog semantics, zoom controls, and no download buttons", () => {
    const modalContent = fs.readFileSync(modalComponentPath, "utf-8");

    // Dialog semantics
    expect(modalContent).toContain('role="dialog"');
    expect(modalContent).toContain('aria-modal="true"');
    expect(modalContent).toContain('aria-labelledby="terms-dialog-title"');
    expect(modalContent).toContain('aria-label="Close Terms & Conditions"');

    // Escape key handling
    expect(modalContent).toContain('e.key === "Escape"');

    // Zoom controls
    expect(modalContent).toContain('zoomIn');
    expect(modalContent).toContain('zoomOut');
    expect(modalContent).toContain('resetZoom');

    // Page navigation
    expect(modalContent).toContain('scrollToPage');
    expect(modalContent).toContain('activePage');
    expect(modalContent).toContain('numPages');

    // Must NOT have obvious download or print buttons
    expect(modalContent.toLowerCase()).not.toContain('download="');
    expect(modalContent.toLowerCase()).not.toContain('window.print()');
    expect(modalContent).not.toContain('<a href="/SAVISKAR_2K26_Official_Terms_Conditions.pdf" download');
  });

  it("5. Verifies standalone /terms route and viewer exists", () => {
    expect(fs.existsSync(standaloneTermsPagePath)).toBe(true);
    expect(fs.existsSync(standaloneTermsViewerPath)).toBe(true);

    const viewerContent = fs.readFileSync(standaloneTermsViewerPath, "utf-8");
    expect(viewerContent).toContain("SAVISKAR_2K26_Official_Terms_Conditions.pdf");
    expect(viewerContent).toContain("Return to Registration");
  });
});
