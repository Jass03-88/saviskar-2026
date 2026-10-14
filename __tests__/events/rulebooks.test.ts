import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { EVENT_RULEBOOKS, getEventRulebook } from "@/lib/events/rulebooks";

describe("Event Rulebook Mapping & File Existence", () => {
  it("has exactly 49 mapped events across cultural, non-technical, and technical realms", () => {
    const keys = Object.keys(EVENT_RULEBOOKS);
    expect(keys.length).toBe(49);
  });

  it("ensures every mapped event has a corresponding physical PDF in public/rulebooks/events/", () => {
    const publicEventsDir = path.join(process.cwd(), "public", "rulebooks", "events");
    expect(fs.existsSync(publicEventsDir)).toBe(true);

    for (const [slug, info] of Object.entries(EVENT_RULEBOOKS)) {
      expect(info.slug).toBe(slug);
      expect(info.pdfUrl).toBe(`/rulebooks/events/${slug}.pdf`);
      expect(info.startPage).toBeGreaterThanOrEqual(1);
      expect(info.endPage).toBeGreaterThanOrEqual(info.startPage);
      expect(info.pageCount).toBe(info.endPage - info.startPage + 1);

      const filePath = path.join(process.cwd(), "public", info.pdfUrl);
      expect(fs.existsSync(filePath), `Missing PDF file for event: ${slug} at ${filePath}`).toBe(true);

      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(1000); // Verify it's a non-empty valid PDF
    }
  });

  it("ensures master realm rulebooks exist in public/rulebooks/", () => {
    const masterCultural = path.join(process.cwd(), "public", "rulebooks", "saviskar-2026-cultural-rulebook.pdf");
    const masterNonTech = path.join(process.cwd(), "public", "rulebooks", "saviskar-2026-non-technical-rulebook.pdf");
    const masterTech = path.join(process.cwd(), "public", "rulebooks", "saviskar-2026-technical-rulebook.pdf");

    expect(fs.existsSync(masterCultural)).toBe(true);
    expect(fs.existsSync(masterNonTech)).toBe(true);
    expect(fs.existsSync(masterTech)).toBe(true);
  });

  it("retrieves the correct rulebook by exact slug", () => {
    const dance = getEventRulebook("footlose-solo-western-dance");
    expect(dance.name).toBe("Footlose - Solo Western dance");
    expect(dance.category).toBe("cultural");
    expect(dance.startPage).toBe(4);
    expect(dance.pdfUrl).toBe("/rulebooks/events/footlose-solo-western-dance.pdf");

    const webDev = getEventRulebook("web-dev-sprint");
    expect(webDev.name).toBe("Web-Dev Sprint");
    expect(webDev.category).toBe("technical");
    expect(webDev.startPage).toBe(4);
    expect(webDev.pdfUrl).toBe("/rulebooks/events/web-dev-sprint.pdf");

    // Also resolves with space
    const webDevBySpace = getEventRulebook("Web Dev Sprint");
    expect(webDevBySpace.slug).toBe("web-dev-sprint");
  });

  it("retrieves the correct rulebook by event name (with case variations and punctuation)", () => {
    const roborace = getEventRulebook("Roborace");
    expect(roborace.slug).toBe("roborace");
    expect(roborace.category).toBe("technical");

    const adMad = getEventRulebook("AD MAD SHOW");
    expect(adMad.slug).toBe("ad-mad-show");
    expect(adMad.category).toBe("non-technical");

    const caseMystique = getEventRulebook("The Case Mystique");
    expect(caseMystique.slug).toBe("the-case-mystique");
    expect(caseMystique.category).toBe("non-technical");
  });

  it("gracefully falls back to category master rulebook when event identifier is unknown", () => {
    const fallbackTech = getEventRulebook("unknown-mystery-event", "technical");
    expect(fallbackTech.pdfUrl).toBe("/rulebooks/saviskar-2026-technical-rulebook.pdf");
    expect(fallbackTech.category).toBe("technical");

    const fallbackCult = getEventRulebook("", "cultural");
    expect(fallbackCult.pdfUrl).toBe("/rulebooks/saviskar-2026-cultural-rulebook.pdf");
    expect(fallbackCult.category).toBe("cultural");

    const fallbackNonTech = getEventRulebook(null, "non-technical");
    expect(fallbackNonTech.pdfUrl).toBe("/rulebooks/saviskar-2026-non-technical-rulebook.pdf");
    expect(fallbackNonTech.category).toBe("non-technical");
  });
});
