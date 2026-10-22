import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Admin & Accommodations Initial Data Loading Architecture", () => {
  const adminPagePath = path.resolve(process.cwd(), "app/admin/page.tsx");
  const accommodationsPagePath = path.resolve(process.cwd(), "app/admin/accommodations/page.tsx");
  const loaderPath = path.resolve(process.cwd(), "components/admin/AdminPageLoader.tsx");

  it("AdminPageLoader component is correctly structured with standard visual elements", () => {
    expect(fs.existsSync(loaderPath)).toBe(true);
    const content = fs.readFileSync(loaderPath, "utf-8");

    // Standard visual elements from Analytics loader
    expect(content).toContain("BarChart3");
    expect(content).toContain("animate-spin text-violet-400");
    expect(content).toContain("bg-black text-white shadow-xl animate-pulse");
    expect(content).toContain("min-h-screen bg-[#f5f5f5]");
  });

  it("Admin dashboard gates initial render with hasLoaded state to prevent zero-card flash", () => {
    const content = fs.readFileSync(adminPagePath, "utf-8");

    // hasLoaded state declaration
    expect(content).toContain("const [hasLoaded, setHasLoaded] =");
    expect(content).toContain("useState(false)");

    // Initial render gate
    expect(content).toContain("if (!hasLoaded) {");
    expect(content).toContain("<AdminPageLoader");
    expect(content).toContain('heading="Loading Admin Dashboard..."');
    expect(content).toContain('subtext="Fetching registrations and dashboard statistics."');

    // hasLoaded is set to true only after data arrives
    expect(content).toContain("setHasLoaded(true);");

    // Single unified loadData called in useEffect instead of separate divergent init()
    expect(content).toContain("void loadData(false);");
    expect(content).not.toContain("async function init()");
  });

  it("Admin dashboard provides retry UI on initial load failure and revalidation error", () => {
    const content = fs.readFileSync(adminPagePath, "utf-8");

    // Initial load failure UI with Retry
    expect(content).toContain("Failed to Load Dashboard");
    expect(content).toContain('onClick={() => loadData(false)}');
    expect(content).toContain("Retry");

    // Subsequent revalidation error banner with Retry
    expect(content).toContain('onClick={() => loadData(true)}');
  });

  it("Accommodations page gates initial render with AdminPageLoader instead of text message", () => {
    const content = fs.readFileSync(accommodationsPagePath, "utf-8");

    // Replaced text-only loading
    expect(content).not.toContain("<p className=\"text-sm text-black/60\">Loading accommodations...</p>");

    // Uses shared AdminPageLoader
    expect(content).toContain("<AdminPageLoader");
    expect(content).toContain('heading="Loading Accommodations..."');
    expect(content).toContain('subtext="Fetching accommodation bookings and availability."');

    // Error recovery with Retry
    expect(content).toContain("Failed to Load Accommodations");
    expect(content).toContain("loadData(false)");
  });
});
