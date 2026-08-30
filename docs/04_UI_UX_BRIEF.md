# Saviskar 2026 — UI/UX Brief

---

## 1. Design Aesthetics

Saviskar 2026 uses a **"premium dark mode"** aesthetic. The design is intended to feel highly modern, technical, and slightly mysterious, fitting the vibe of a large-scale university fest.

### Key Visual Principles
- **Deep Dark Theme**: True blacks (`#000000`) and very dark grays (`#050505`, `#0A0A0A`) form the foundation.
- **Glassmorphism**: Extensive use of translucent surfaces (`backdrop-blur`) over deep, subtle gradients to create depth without harsh borders.
- **Micro-interactions**: Everything should feel alive. Buttons, cards, and inputs have subtle hover states (scale, border-glow).
- **Typography**: Uses the `Geist` and `Geist Mono` font families (provided by Vercel). High contrast for primary text, low contrast (gray) for secondary data.
- **High-End Feel**: Avoiding "default" Tailwind looks. Custom shadows, custom borders, and highly controlled padding/margins.

---

## 2. Animation & Motion

Animations are a core part of the Saviskar 2026 experience. 

### Technologies Used
- **Framer Motion**: For component-level layout animations, exit animations, and complex state transitions (e.g., the registration form stepping).
- **GSAP**: Used for scroll-linked animations and complex timeline sequencing on the landing pages.
- **OGL / WebGL**: Used for high-performance background effects (e.g., the `AuroraBackground` and `Lightfall` components).

### Key Animation Patterns
- **Fade-Up on Scroll**: Sections gently fade and translate upward as they enter the viewport.
- **Spotlight Hover Effects**: Cards (like event cards) have a dynamic radial gradient that follows the user's cursor (`MouseSpotlight`).
- **Text Reveals**: Using components like `BlurText` or `SplitText` to reveal headers character-by-character or word-by-word.
- **Seamless Page Transitions**: Using `StageTransition` to avoid harsh flash-of-white page loads.

---

## 3. Core Pages & Layouts

### 3.1 Public Landing Page (`/`)
- **Hero Section**: High-impact text over a dynamic WebGL background (`AuroraBackground` or `StarNightReveal`).
- **Events Showcase**: Horizontal or grid-based cards showing event categories. Uses the `MouseSpotlight` effect.
- **Registration CTA**: Prominent, glowing button directing to the `/register` route.

### 3.2 Registration Flow (`/register`)
- **Multi-step Form**: Presented as a single page with smooth height transitions (Framer Motion `AnimatePresence`).
- **Glass Cards**: The form sits inside a frosted glass container over a dark, animated background (`Lightfall` effect).
- **Clear State Indicators**: Visual differences between "Free" (white/gray accents), "Paid" (subtle colored glows), and "Error" (red borders).
- **Responsive**: Fully optimized for mobile devices, as 90% of registrations happen on phones.

### 3.3 Admin Dashboard (`/admin`)
- **Utility over Flash**: The admin panel drops the heavy WebGL effects in favor of clean, fast, data-dense tables.
- **Status Badges**: 
  - `PAID`: Solid green background, white text.
  - `PENDING`: Outline red border, red text.
  - `FREE`: Gray background, white text.
- **Slide-over Panels**: Detail views (like viewing a team's members) open in slide-over panels rather than new pages to maintain context.

---

## 4. Component System

### Shared UI (`components/ui/`)
- `Navbar.tsx`: Sticky, glassmorphism header. Blends into the background when scrolled to top, gains a border and blur when scrolled down.
- `Footer.tsx`: Clean, minimalist footer with essential links.
- `GlassSurface.tsx`: A reusable wrapper for cards and panels that applies the standard backdrop-blur, subtle border, and background tint.
- `MouseSpotlight.tsx`: A wrapper that tracks cursor position and applies a CSS radial-gradient to the background of its children.

### Emails (HTML)
- Registration and receipt emails match the dark aesthetic.
- True black (`#050505`) headers with white text.
- Clean, bordered content sections with monospace ID readouts.
- Embedded QR codes displayed clearly against white backgrounds to ensure scanability.

---

## 5. Responsive Strategy

- **Mobile First**: All forms, cards, and navigation are built for mobile screens first (base Tailwind classes).
- **Tablet (`md:`)**: Forms shift to two-column layouts where appropriate.
- **Desktop (`lg:`)**: Background effects become more prominent. Navigation moves to a horizontal layout.

---

## 6. Accessibility

- **Contrast**: Ensuring text over glassmorphism backgrounds maintains high contrast ratios.
- **Focus States**: Custom focus rings (`ring-2 ring-white/20`) on all interactive elements.
- **Reduced Motion**: Respecting user OS preferences by disabling heavy WebGL and GSAP animations if `prefers-reduced-motion` is enabled.
