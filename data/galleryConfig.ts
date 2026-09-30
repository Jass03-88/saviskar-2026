/**
 * ============================================================================
 * SAVISKAR 2026 — GOOGLE DRIVE GALLERY CONFIGURATION
 * ============================================================================
 * 
 * Configure external Google Drive images for the "Main Gallery" and "Glimpse Gallery".
 * 
 * OPTION 1: PASTE YOUR TWO GOOGLE DRIVE LINKS DIRECTLY BELOW
 * ----------------------------------------------------------------------------
 * Replace the string values below with your Google Drive links:
 * - Public Folder URL: "https://drive.google.com/drive/folders/1abc...xyz?usp=sharing"
 * - Direct Shared Link: "https://drive.google.com/file/d/1abc...xyz/view"
 * 
 * OPTION 2: CONFIGURE VIA ENVIRONMENT VARIABLES (.env.local)
 * ----------------------------------------------------------------------------
 * Alternatively, leave the strings below as fallback and define them in .env.local:
 *   NEXT_PUBLIC_MAIN_GALLERY_GDRIVE_URL="https://drive.google.com/drive/folders/..."
 *   NEXT_PUBLIC_GLIMPSE_GALLERY_GDRIVE_URL="https://drive.google.com/drive/folders/..."
 * ============================================================================
 */

export const GDRIVE_GALLERY_CONFIG = {
  /**
   * 1. MAIN GALLERY GOOGLE DRIVE URL
   * Configured with your provided Google Drive link:
   */
  mainGalleryDriveUrl:
    process.env.NEXT_PUBLIC_MAIN_GALLERY_GDRIVE_URL ||
    "https://drive.google.com/drive/folders/1sKBgnkvnwO53Wvcg_m26MfOQidN3szL9?usp=share_link",

  /**
   * 2. GLIMPSE GALLERY GOOGLE DRIVE URL
   * Configured with your provided Google Drive link:
   */
  glimpseGalleryDriveUrl:
    process.env.NEXT_PUBLIC_GLIMPSE_GALLERY_GDRIVE_URL ||
    "https://drive.google.com/drive/folders/1eIpgYcrOpKOfBvw-FsbQ8-vAn-ysqomb?usp=sharing",
};

/**
 * Optional manually pinned Google Drive photo items if you want specific custom
 * titles and categories for individual Google Drive images in the Main Gallery.
 */
export interface GDriveImageItem {
  id: string;
  driveUrlOrId: string;
  title: string;
  category: "Main Stage" | "Technical & AI" | "Culture & Arts" | "Showcases" | "Sports" | "Campus" | "Behind the Scenes";
  description: string;
  aspectRatio?: "landscape" | "portrait" | "wide";
  location?: string;
  featured?: boolean;
}

export const PINNED_GDRIVE_ITEMS: GDriveImageItem[] = [
  // Example of pinning specific images if needed:
  // {
  //   id: "gdrive-1",
  //   driveUrlOrId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  //   title: "Stadium Grand Illumination",
  //   category: "Main Stage",
  //   description: "Concert stage lasers illuminating 35,000+ attendees at CGC University.",
  //   aspectRatio: "wide",
  //   featured: true,
  // }
];
