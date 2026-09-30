export interface GalleryVideo {
  id: string;
  title: string;
  subtitle: string;
  category: "Anthem & Keynotes" | "Interviews & Talks" | "Behind the Scenes" | "Cinematic" | "Teasers";
  youtubeUrl: string;
  thumbnailUrl: string;
  featured?: boolean;
  dateBadge: string;
  description: string;
}

export interface GalleryImage {
  id: string;
  fileId?: string;
  src: string;
  thumbnailSrc?: string;
  title: string;
  category: "Main Stage" | "Technical & AI" | "Culture & Arts" | "Showcases" | "Sports" | "Campus" | "Behind the Scenes";
  description: string;
  location?: string;
  featured?: boolean;
  aspectRatio?: "landscape" | "portrait" | "wide";
}

export const YOUTUBE_CHANNEL_META = {
  name: "Saviskar CGC University",
  handle: "@SaviskarCGCU",
  url: "https://www.youtube.com/@SaviskarCGCU",
  channelId: "SaviskarCGCU",
  badge: "Official Festival Broadcast",
  stats: "50+ Realms // 35,000+ Participants // Official 4K Stream",
  description:
    "The official audiovisual chronicles, festival anthems, star night teasers, leadership podcasts, and backstage dispatches from CGC University, Mohali.",
};

export const GALLERY_VIDEOS: GalleryVideo[] = [
  {
    id: "ntViBakZP7w",
    title: "Saviskar Anthem: The Nexus of Next-Gen Tech",
    subtitle: "Official Festival Anthem // Experience the Magic",
    category: "Anthem & Keynotes",
    youtubeUrl: "https://www.youtube.com/watch?v=ntViBakZP7w",
    thumbnailUrl: "https://img.youtube.com/vi/ntViBakZP7w/maxresdefault.jpg",
    featured: true,
    dateBadge: "OFFICIAL ANTHEM",
    description:
      "Step into the sonic universe of Saviskar. High-octane visuals and electric festival rhythm capturing the collective pulse of 35,000+ participants across India.",
  },
  {
    id: "hFJPQ7qG2MY",
    title: "Saviskar Unplugged — Episode 01",
    subtitle: "Prof. (Dr.) Sachin Sharma in Conversation with Aditya Chaudhary",
    category: "Interviews & Talks",
    youtubeUrl: "https://www.youtube.com/watch?v=hFJPQ7qG2MY",
    thumbnailUrl: "https://img.youtube.com/vi/hFJPQ7qG2MY/maxresdefault.jpg",
    featured: true,
    dateBadge: "PODCAST // EP.01",
    description:
      "An in-depth dialogue on the architectural philosophy, administrative rigor, and student empowerment that turn Saviskar into North India's premier techno-cultural phenomenon.",
  },
  {
    id: "0EBARKa3EUA",
    title: "Team Reveal: The Architects of Saviskar",
    subtitle: "Organising Directorate & Student Advisory Council",
    category: "Behind the Scenes",
    youtubeUrl: "https://www.youtube.com/watch?v=0EBARKa3EUA",
    thumbnailUrl: "https://img.youtube.com/vi/0EBARKa3EUA/maxresdefault.jpg",
    featured: false,
    dateBadge: "CORE REVEAL",
    description:
      "Spotlighting the minds behind the spectacle — from the faculty leadership and operations engine to the student core leads powering 50+ festival realms.",
  },
  {
    id: "XwuAVNWB3xM",
    title: "What You Didn't See on Camera | BTS",
    subtitle: "Uncensored Festival Ground Operations",
    category: "Behind the Scenes",
    youtubeUrl: "https://www.youtube.com/watch?v=XwuAVNWB3xM",
    thumbnailUrl: "https://img.youtube.com/vi/XwuAVNWB3xM/maxresdefault.jpg",
    featured: false,
    dateBadge: "BTS EXCLUSIVE",
    description:
      "Late-night lighting rehearsals, adrenaline-fueled coordination desks, green room moments, and the unvarnished camaraderie that makes the festival come alive.",
  },
  {
    id: "vbwvc3LUXwo",
    title: "The Saviskar Vision & Student Legacy",
    subtitle: "Featuring Dean Student Affairs Dr. Sachin Sharma",
    category: "Interviews & Talks",
    youtubeUrl: "https://www.youtube.com/watch?v=vbwvc3LUXwo",
    thumbnailUrl: "https://img.youtube.com/vi/vbwvc3LUXwo/maxresdefault.jpg",
    featured: false,
    dateBadge: "LEADERSHIP",
    description:
      "Exploring how CGC University creates an interdisciplinary launchpad where technology, performance arts, and national student networks converge.",
  },
  {
    id: "MRld-uOkWDU",
    title: "Where Dreams Touch Innovation",
    subtitle: "Aevorian Reverie Cinematic Trailer",
    category: "Cinematic",
    youtubeUrl: "https://www.youtube.com/watch?v=MRld-uOkWDU",
    thumbnailUrl: "https://img.youtube.com/vi/MRld-uOkWDU/maxresdefault.jpg",
    featured: false,
    dateBadge: "CINEMATIC",
    description:
      "A stunning visual odyssey through illuminated campus corridors, laser-sculpted mainstages, and the competitive fire of thousands of visiting delegates.",
  },
  {
    id: "vY4YCcX59NQ",
    title: "11 Days Left: The Excitement Builds",
    subtitle: "Festival Countdown Dispatch",
    category: "Teasers",
    youtubeUrl: "https://www.youtube.com/watch?v=vY4YCcX59NQ",
    thumbnailUrl: "https://img.youtube.com/vi/vY4YCcX59NQ/maxresdefault.jpg",
    featured: false,
    dateBadge: "COUNTDOWN",
    description:
      "T-minus 11 days. The campus transforms into an electric arena as stage constructions begin and registrations cross all prior benchmarks.",
  },
  {
    id: "lCcXElYgDLo",
    title: "12 Days to Go: The Countdown Begins",
    subtitle: "Saviskar Teaser Release",
    category: "Teasers",
    youtubeUrl: "https://www.youtube.com/watch?v=lCcXElYgDLo",
    thumbnailUrl: "https://img.youtube.com/vi/lCcXElYgDLo/maxresdefault.jpg",
    featured: false,
    dateBadge: "COUNTDOWN",
    description:
      "Official launch countdown marking the countdown to unforgettable live concerts, hackathons, and high-intensity campus battles.",
  },
];
import { MAIN_GALLERY_GDRIVE_IMAGES } from "@/data/gdriveManifest";

export const GALLERY_IMAGES: GalleryImage[] = MAIN_GALLERY_GDRIVE_IMAGES;

export const PHOTO_CATEGORIES = [
  "All",
  "Main Stage",
  "Technical & AI",
  "Culture & Arts",
  "Showcases",
  "Sports",
  "Campus",
  "Behind the Scenes",
] as const;

export const VIDEO_CATEGORIES = [
  "All",
  "Anthem & Keynotes",
  "Interviews & Talks",
  "Behind the Scenes",
  "Cinematic",
  "Teasers",
] as const;
