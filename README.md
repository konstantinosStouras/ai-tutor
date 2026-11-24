# Module Tutor frontend

Static HTML, CSS and JavaScript for the existing GitHub Pages site. Publish this
repository as the `ai-tutor` submodule in `konstantinosStouras.github.io`; do not
enable a second Pages site or change the website CNAME/Jekyll configuration.

The public entry shows only Google sign-in. Module data, dashboards and
conversation history load only after authentication and server authorization.
The student layout follows the supplied green, cream and gold interface.

Routes work without web-server rewrites:

- `/ai-tutor/` — Google sign-in, then the authorized dashboard.
- `/ai-tutor/#/create` — instructor setup.
- `/ai-tutor/#/admin/MODULE_ID` — separate instructor administration.
- `/ai-tutor/bmgt41040` — student link, initially derived from the module code. Instructors can edit its ending in **Preview & publication**. Previous endings and legacy `#/t/MODULE_ID` links continue to open the same tutor after authorization. The site's root 404 handler forwards clean paths to the tutor app on GitHub Pages.
- `/ai-tutor/#/preview/MODULE_ID` — authorized instructor draft preview.
- `/ai-tutor/#/privacy/MODULE_ID` — recording, retention, export and erasure details.

`config.js` contains public Firebase identifiers and an App Check public site key.
Never place an AI provider key or service account credential in frontend files.
The backend is maintained separately in `ai-tutor-backend`.

For local development serve this folder over HTTP, authorize localhost in Firebase
Authentication and App Check, and use the backend emulator instructions. No mock
provider or demo account is included in the production frontend. Browser tests
intercept Firebase modules explicitly; their test responses are not live AI.

Local update: student chat now includes microphone dictation, one private document attachment per question, and expandable English translations. The backend update must be deployed alongside this frontend before publishing. Voice input uses stop-and-transcribe; students review the original-language transcript before sending.
