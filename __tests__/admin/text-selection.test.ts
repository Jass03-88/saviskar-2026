import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Admin Text Selection Scoping & High-Contrast Rules", () => {
  const globalsCssPath = path.resolve(process.cwd(), "app/globals.css");
  const adminLayoutPath = path.resolve(process.cwd(), "app/admin/layout.tsx");

  it("globals.css defines scoped .admin-root selection with #2563EB and #FFFFFF", () => {
    const content = fs.readFileSync(globalsCssPath, "utf-8");

    // Scoped rules for .admin-root
    expect(content).toContain(".admin-root ::selection");
    expect(content).toContain(".admin-root::selection");
    expect(content).toContain(".admin-root input::selection");
    expect(content).toContain(".admin-root textarea::selection");

    // Hex values and !important
    expect(content).toMatch(/\.admin-root ::selection\s*\{[^}]*background-color:\s*#2563EB !important;/);
    expect(content).toMatch(/\.admin-root ::selection\s*\{[^}]*color:\s*#FFFFFF !important;/);

    // Vendor-specific ::-moz-selection rules are distinct and unmixed
    expect(content).toContain(".admin-root ::-moz-selection");
    expect(content).toContain(".admin-root::-moz-selection");
    expect(content).toContain(".admin-root input::-moz-selection");
    expect(content).toContain(".admin-root textarea::-moz-selection");

    // Must NOT mix ::selection and ::-moz-selection in a single selector list
    expect(content).not.toMatch(/::selection\s*,\s*::-moz-selection/);
  });

  it("globals.css preserves default global selection for public website", () => {
    const content = fs.readFileSync(globalsCssPath, "utf-8");

    // Public website selection
    expect(content).toMatch(/::selection\s*\{\s*background:\s*white;\s*color:\s*black;\s*\}/);
  });

  it("app/admin/layout.tsx encloses admin routes inside .admin-root wrapper", () => {
    const content = fs.readFileSync(adminLayoutPath, "utf-8");

    expect(content).toContain('className="admin-root selection:bg-[#2563EB] selection:text-white min-h-screen"');
    expect(content).toContain('data-admin-root');
    expect(content).toContain('<AdminSessionWatcher />');
    expect(content).toContain('{children}');
  });
});
