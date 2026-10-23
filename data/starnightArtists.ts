export type DayPerformance = {
  dayNumber: string; // "DAY 01" | "DAY 02"
  date?: string;
  theme?: string;
  artists: string;
  genre: string;
  description: string;
  badge: string;
  image: string;
  highlights: string[];
};

export type FestivalEdition = {
  year: string;
  edition: string;
  subtitle: string;
  attendance: string;
  tagline: string;
  heroImage: string;
  days: DayPerformance[];
};

// Legacy Artist type for backward compatibility
export type Artist = {
  year: string;
  artist: string;
  genre: string;
  attendance: string;
  tagline: string;
  image: string;
  featured?: boolean;
};

export const festivalEditions: FestivalEdition[] = [
  {
    year: "2025",
    edition: "Saviskar 2025",
    subtitle: "The Electric Double-Header",
    attendance: "35,000+ Crowd",
    tagline:
      "Two monumental nights that ignited CGC University into Northern India's loudest stadium chorus.",
    heroImage: "/images/concert.webp",
    days: [
      {
        dayNumber: "DAY 01",
        date: "Saviskar '25 • Opening Night",
        theme: "Acoustic Soul & High-Octane Punjabi Folk",
        artists: "Kushagra Thakur & Sunanda Sharma",
        genre: "Indie Rock • Acoustic Melodies • Powerhouse Punjabi Folk",
        description:
          "Opening night electrified the stadium, starting with Kushagra Thakur's intimate acoustic anthems and soulful indie melodies, escalating into Sunanda Sharma's high-octane Punjabi folk set that had 35,000 voices singing every lyric at the top of their lungs.",
        badge: "OPENING NIGHT",
        image: "/images/artists/artist-3-kushagra-sunanda.webp",
        highlights: [
          "Soulful Acoustic Anthems",
          "High-Energy Punjabi Folk",
          "Massive Opening Night Chorus",
        ],
      },
      {
        dayNumber: "DAY 02",
        date: "Saviskar '25 • Grand Finale",
        theme: "The Master Bollywood Symphony",
        artists: "Salim-Sulaiman",
        genre: "Bollywood Symphony • Sufi Anthems • Live Orchestra & Dhol",
        description:
          "The iconic composer duo orchestrated an unforgettable stadium finale with sweeping Bollywood classics, soaring Sufi rhythms, live dhol percussion, and 35,000 voices echoing under the night sky.",
        badge: "GRAND FINALE",
        image: "/images/artists/artist-4-salim-sulaiman.webp",
        highlights: [
          "Full Live Symphony & Dhol",
          "Timeless Sufi Classics",
          "Stadium-Wide Singalong",
        ],
      },
    ],
  },
  {
    year: "2024",
    edition: "Saviskar 2024",
    subtitle: "Mystic Sufi to Stadium Bollywood Rock",
    attendance: "20,000+ Crowd",
    tagline:
      "A transcendent spectrum of sound: from the sacred depths of Sufi poetry to soaring Bollywood rock anthems.",
    heroImage: "/images/concert-stadium.webp",
    days: [
      {
        dayNumber: "DAY 01",
        date: "Saviskar '24 • Sufi Night",
        theme: "Sufi & Qawwali Mysticism",
        artists: "Sufi Night by Waqar Khan",
        genre: "Mystical Sufi • Acoustic Harmonium • Soulful Ghazals",
        description:
          "Waqar Khan enchanted the CGC amphitheatre with an ethereal Sufi Night. Intimate acoustic strings, meditative qawwalis, and centuries of lyrical devotion created an unforgettable spiritual reverie under the stars.",
        badge: "SUFI NIGHT",
        image: "/images/artists/artist-1-waqar-khan.webp",
        highlights: [
          "Enchanting Sufi Poetry",
          "Soul-Stirring Ghazals",
          "Acoustic Mysticism",
        ],
      },
      {
        dayNumber: "DAY 02",
        date: "Saviskar '24 • Grand Finale",
        theme: "Romantic Bollywood Rock Wave",
        artists: "Ankit Tiwari",
        genre: "Bollywood Rock • Melodic Ballads • Cinematic Romance",
        description:
          "Bollywood sensation Ankit Tiwari commanded the stage with chart-shattering anthems like 'Galliyan' and 'Sunn Raha Hai', turning the stadium grounds into a shimmering sea of flashlight waves.",
        badge: "BOLLYWOOD HEADLINER",
        image: "/images/artists/artist-2-ankit-tiwari.webp",
        highlights: [
          "Chart-Busting Bollywood Hits",
          "Sea of Flashlights",
          "Rock & Romance Fusion",
        ],
      },
    ],
  },
];

// Flat artists export mapped from festivalEditions for backward compatibility
export const artists: Artist[] = festivalEditions.map((ed) => ({
  year: ed.year,
  artist: ed.days.map((d) => `${d.dayNumber}: ${d.artists}`).join(" • "),
  genre: ed.days.map((d) => d.genre.split("•")[0].trim()).join(" • "),
  attendance: ed.attendance,
  tagline: ed.tagline,
  image: ed.heroImage,
  featured: true,
}));

export const headliners2026 = [
  {
    day: "DAY 01",
    artist: "Asees Kaur",
    status: "OFFICIAL HEADLINER // LIVE IN CONCERT",
    stage: "CGC MAINSTAGE ARENA",
    theme: "Bollywood Playback Powerhouse • Romantic Anthems & Pop Soul",
    teaser:
      "The award-winning voice behind Bollywood chart-toppers 'Raataan Lambiyan', 'Makhna', 'Bolna', and 'Ve Maahi'. Ready to electrify 35,000+ voices on Day 01.",
    targetFrequency: "102.6 MHz",
  },
  {
    day: "DAY 02",
    artist: "Ranjit Bawa",
    status: "GRAND FINALE HEADLINER // LIVE IN CONCERT",
    stage: "CGC MAINSTAGE ARENA",
    theme: "High-Octane Punjabi Folk • Bhangra Legend • Thumping Dhol",
    teaser:
      "Punjab's powerhouse voice behind 'Yaari Chandigarh Waliye', 'Jatt Di Akal', and 'Sher Marna'. Primed to shake the stadium for the Saviskar 2026 Grand Finale.",
    targetFrequency: "102.6 MHz",
  },
];