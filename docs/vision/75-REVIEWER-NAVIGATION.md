# Reviewer navigation and workspace menus

Verified locally on 2026-10-05.

- Vision Overview shows up to six clips with an available review proxy. Each has an Open review link to its identity/event workstation, match title, duration and tracking status. Browse all footage reaches the complete list.
- Footage also places Open review beside the source title, before the wide pipeline columns. Workstation links require an available proxy and review permission.
- Password sign-in returns to the original admin destination, including query and fragment. Invalid/external destinations fall back to the role landing page. Annotation is omitted from Overview for reviewers without annotation permission; configuration panels remain available to job operators.
- Hide/Show main menu and Hide/Show Vision menu independently reclaim content width. Preferences persist in browser storage; inaccessible storage does not prevent toggling. Controls expose expanded state and their controlled navigation IDs.

## QA

- 233 web tests passed, including regression coverage for sign-in destinations; production build and diff whitespace check passed.
- Authorized local reviewer sign-in returned to pilot asset `c89444b0-2b9b-4af4-a616-ff29b9dc75a8`.
- Overview and Footage Open review links both reached that workstation without submitting review decisions.
- Both menus collapsed and expanded; collapsed preferences survived reload and navigation. At a 1440px viewport the content width grew from 624px to 1104px when both menus were collapsed.
- At a 390px viewport no page horizontal overflow occurred with menus collapsed. Temporary viewport overrides were reset after testing.
- Pilot video still has no player tracks or generated event candidates; opening the workstation does not imply those pipeline stages have run.
