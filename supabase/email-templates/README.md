# noveltyOS email templates

Paste these into **Supabase → Authentication → Emails → Templates**. Editing templates requires custom SMTP (Resend) first.

| Supabase template | Subject | Body (paste the whole file) |
|---|---|---|
| **Confirm signup** | `Your noveltyOS confirmation code: {{ .Token }}` | `confirm-signup.html` |
| **Reset password** | `Your noveltyOS password reset code: {{ .Token }}` | `reset-password.html` |

Both use only the one-time code (`{{ .Token }}`) and contain **no links**: the code is typed into the app, so nothing can be
opened on the wrong device and there's no redirect URL to misconfigure.
