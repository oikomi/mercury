# Xiaohongshu Real Account Login Design

## Goal

Run the existing Xiaohongshu publishing workspace against one real local account instead of the mock provider. The account login is completed manually by the user in a browser window.

## Chosen Approach

Mercury uses the existing Playwright provider with a dedicated persistent Chrome profile at `.data/xhs-profile`.

- Set `XHS_PROVIDER=playwright` in the local web environment.
- Keep `XHS_PROFILE_DIR=.data/xhs-profile` and `XHS_ARTIFACT_DIR=.data/xhs-artifacts` local to the repository.
- The dashboard's `打开登录窗口` action opens Xiaohongshu Creator Center through that profile.
- The user completes QR-code or phone login directly in the opened browser.
- Once Creator Center is ready, the provider closes the browser and retains only the local profile data for future session checks and publishing.

## Alternatives Considered

1. Dedicated Playwright profile: selected because it avoids colliding with the user's everyday Chrome profile and makes the service-owned session explicit.
2. Reuse the everyday Chrome profile: rejected because Chrome can lock the profile and it exposes unrelated browsing state to the application.
3. Keep the mock provider: rejected because it cannot establish or verify a real Xiaohongshu session.

## Safety And Error Handling

- Mercury never requests, records, or transmits the user's Xiaohongshu password.
- It does not automate CAPTCHA, device verification, or risk-control challenges.
- Cookies remain in the local Chrome profile and are never stored in the database or returned to the web client.
- A missing or expired session is shown as `需要登录`; the user can launch the login window again.
- Browser failures retain only a local debugging screenshot in `.data/xhs-artifacts`.

## Validation

- Provider selection is covered by the existing provider-factory unit test.
- The local environment change is verified by restarting Mercury, checking that the dashboard reports `需要登录`, and completing manual login through the opened browser.
- The real account name is not scraped in this change; the dashboard reports session readiness only.
