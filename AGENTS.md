<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Collaboration & Git Workflow Rules

- **MANDATORY PULL BEFORE COMMIT / PUSH**:
  This is a shared repository with multiple collaborators. Always pull the latest changes before committing any push to the remote repository:
  ```powershell
  git pull --rebase origin <branch_name>
  ```
  Ensure any conflicts are resolved and tests/builds pass cleanly before committing and pushing.
- **Branching Strategy**: Develop on dedicated feature branches (e.g., `feat/<feature-name>`) rather than pushing directly to `main`.
- **Shell Discipline**: Never chain commands with `&&` or `||` in PowerShell. Run one command per invocation.

# Landing Page Lock Policy

- **STRICTLY LOCKED**: The main landing page is finalized and locked. Do NOT modify, alter, refactor, or delete the following files:
  - `app/page.tsx`
  - `components/home/LandingPage.tsx`
  - `components/home/Hero.tsx`
  - `components/home/Story.tsx`
  - `components/home/About.tsx`
  - `components/home/GalleryGlimpse.tsx`
  - `components/ui/ScrollEngine3D.tsx`
  - `components/ui/DomeGallery.tsx`
  - `components/ui/Preloader.tsx`
  - `components/ui/Navbar.tsx`
  - `components/ui/Footer.tsx`

