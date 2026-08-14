# Design QA

## Comparison target

- source visual truth: `/Users/jakub/.codex/generated_images/019fff0a-da96-7572-9358-1baaad0aa860/exec-de0fa0df-b270-4e30-879f-db78ab886ef4.png`
- normalized source: `/Users/jakub/Desktop/n8n/daily-news-digest/audit-mobile/source-normalized-390.png`
- implementation screenshot: `/Users/jakub/Desktop/n8n/daily-news-digest/audit-mobile/20-today-light-viewport.png`
- dark-theme screenshot: `/Users/jakub/Desktop/n8n/daily-news-digest/audit-mobile/21-today-dark-viewport.png`
- route: `http://127.0.0.1:3000/`
- state: authenticated, completed digest for 2026-08-14, mobile Today screen
- CSS viewport: `390 x 844`
- source pixels: `853 x 1844`; normalized to `390 x 843`
- implementation pixels: `390 x 844`
- density normalization: source resampled to the implementation width; browser capture matched CSS pixels at device scale factor 1

## Full-view comparison evidence

The normalized source and the final light implementation were opened together in one comparison input. The final version preserves the source hierarchy and mobile rhythm: compact brand/date header, one-row digest status and action, four summary bullets, three priority rows, and a persistent four-item bottom navigation. Dynamic article text and counts differ because the implementation uses the live digest rather than mock content.

## Focused comparison evidence

The same 390 px captures kept the header, summary, card typography, metadata, chevrons, and bottom navigation legible without additional crops. Focused checks were also captured for the News list, article detail, settings, notebook empty state, digest progress, and digest error state in `/Users/jakub/Desktop/n8n/daily-news-digest/audit-mobile/`.

## Required fidelity surfaces

- typography: clear 20 px section hierarchy, compact 13–16 px mobile copy, two-line summary truncation, two-line titles, and single-line importance reasons
- spacing and layout: no horizontal overflow at 390 px; the three priority rows reach the first viewport; fixed navigation respects the content bottom padding
- colors and tokens: warm neutral light theme and green-black dark theme both preserve hierarchy and contrast
- image and icon quality: no raster placeholders or custom-drawn icon substitutes; the interface uses one consistent Lucide icon family
- copy and content: static interface copy is Polish; publisher-owned titles and summaries remain in their source language

## Comparison history

1. Initial findings: P1 summary and importance reasons were too long; P1 raw ranking/debug rationale leaked into the UI; P2 priority rows were too tall; P2 the mobile settings save bar obscured content; P2 the active digest panel was large and mostly English; P1 the Next.js development control covered the Today navigation item.
   Fixes: added mobile line clamps and tighter rhythm, translated technical rationale into reader-friendly explanations, removed the redundant mobile all-news CTA, made the settings action static on mobile, localized and compacted digest progress, disabled the development indicator, and localized primary controls.
   Post-fix evidence: `20-today-light-viewport.png`, `13-settings-light-final.png`, `14-settings-dark-final.png`.
2. Functional finding: P0 the real digest run failed on large Supabase `.in(...)` filters and exposed a full technical stack trace.
   Fixes: batched story-cluster association and editorial-score reads by encoded URL length; shortened user-facing failures to an actionable message.
   Post-fix evidence: the same run advanced through clustering and scoring and completed successfully with 24 published news items; compact error evidence is `12-digest-error-fixed.png`.
3. Final comparison: no actionable P0, P1, or P2 visual differences remain. Remaining differences are expected live-content differences from the mock.

## Primary interactions tested

- authenticated Today screen and bottom navigation
- download-news action through a complete seven-stage digest run
- retry after a failed digest stage
- News list, filter expansion, and article navigation
- article actions and note dialog open/close
- notebook empty-state link to `/news`
- settings navigation and theme switching
- light and dark views for Today, News, Notebook, and Settings
- final browser console warning/error check: none

## Follow-up polish

- P3: live article summaries remain in the publisher language; automatic translation would be a separate content feature rather than a visual mismatch.

final result: passed
