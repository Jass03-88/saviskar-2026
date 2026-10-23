/**
 * Saviskar 2026 — Systematic Artist Profile Placeholders Registry
 * 
 * Defines the 6 standardized artist profiles (4 historical performers and 2 new 2026 headliners).
 * You can update local paths here or provide external image URLs if hosted remotely.
 */

export interface ArtistProfileConfig {
  slot: number;
  id: string;
  year: "2024" | "2025" | "2026";
  day: "Day 01" | "Day 02";
  artistName: string;
  genre: string;
  placeholderPath: string;
  overrideImageUrl?: string;
  status: "archived" | "classified" | "revealed";
}

export const ARTIST_PROFILES: Record<string, ArtistProfileConfig> = {
  "2024-day1": {
    slot: 1,
    id: "artist-2024-day1-waqar-khan",
    year: "2024",
    day: "Day 01",
    artistName: "Sufi Night by Waqar Khan",
    genre: "Mystical Sufi • Acoustic Harmonium • Soulful Ghazals",
    placeholderPath: "/images/artists/artist-1-waqar-khan.webp",
    status: "archived",
  },
  "2024-day2": {
    slot: 2,
    id: "artist-2024-day2-ankit-tiwari",
    year: "2024",
    day: "Day 02",
    artistName: "Ankit Tiwari",
    genre: "Bollywood Rock • Melodic Ballads • Cinematic Romance",
    placeholderPath: "/images/artists/artist-2-ankit-tiwari.webp",
    status: "archived",
  },
  "2025-day1": {
    slot: 3,
    id: "artist-2025-day1-kushagra-sunanda",
    year: "2025",
    day: "Day 01",
    artistName: "Kushagra Thakur & Sunanda Sharma",
    genre: "Indie Rock • Acoustic Melodies • Powerhouse Punjabi Folk",
    placeholderPath: "/images/artists/artist-3-kushagra-sunanda.webp",
    status: "archived",
  },
  "2025-day2": {
    slot: 4,
    id: "artist-2025-day2-salim-sulaiman",
    year: "2025",
    day: "Day 02",
    artistName: "Salim-Sulaiman",
    genre: "Bollywood Symphony • Sufi Anthems • Live Orchestra & Dhol",
    placeholderPath: "/images/artists/artist-4-salim-sulaiman.webp",
    status: "archived",
  },
  "2026-day1": {
    slot: 5,
    id: "artist-2026-day1-asees-kaur",
    year: "2026",
    day: "Day 01",
    artistName: "Asees Kaur",
    genre: "Bollywood Playback Powerhouse • Romantic Anthems & Pop Soul",
    placeholderPath: "/images/artists/artist-5-2026-day1.webp",
    status: "revealed",
  },
  "2026-day2": {
    slot: 6,
    id: "artist-2026-day2-ranjit-bawa",
    year: "2026",
    day: "Day 02",
    artistName: "Ranjit Bawa",
    genre: "High-Octane Punjabi Folk • Bhangra Anthems & Live Dhol",
    placeholderPath: "/images/artists/artist-6-2026-day2.webp",
    status: "revealed",
  },
};

/**
 * Returns the active image source for an artist slot (supports override URL or fallback placeholder).
 */
export function getArtistImage(key: keyof typeof ARTIST_PROFILES): string {
  const profile = ARTIST_PROFILES[key];
  if (!profile) return "/images/concert.webp";
  return profile.overrideImageUrl || profile.placeholderPath;
}
