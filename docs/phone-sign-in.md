# Signing in with a phone number

Customers book with **just their mobile number**: they type it, we text a six-digit code, they
type the code, and they're in. A number we haven't seen before becomes an account there and then —
no form, no password, no e-mail. It works on the sign-in page and, more importantly, right on the
seat map: tap a seat while signed out, enter your number, and the seat you tapped is held the
moment the code is accepted.

Email and password sign-in still works for everyone, and it is the **only** way in for operators
and admins.

## The flow

```
POST /api/v1/auth/phone/code/    {"phone": "077 123 4567"}
  202 {"phone": "+94771234567", "masked_phone": "+9477*****67", "code_length": 6,
       "expires_in": 300, "resend_in": 60}

POST /api/v1/auth/phone/verify/  {"phone": "+94771234567", "code": "307746"}
  201 {"access": "…", "user": {…, "email": null, "has_password": false}, "created": true}
      + the HttpOnly refresh cookie, exactly like a password sign-in
```

On Android, the text ends with `@yathra.lk #307746`, so Chrome offers to fill the code in by
itself (WebOTP); iOS offers it from the keyboard (`autocomplete="one-time-code"`).

## The rules

| Rule | Why |
|------|-----|
| A code works **once**, for **5 minutes**, with **5 guesses** | A six-digit code is only safe with few guesses |
| Only a **keyed hash** of the code is stored; the text itself is never logged | A database or log leak reveals no codes |
| A new code **retires the previous one** | Only the latest text works |
| One code a **minute** and **5 an hour** per phone, plus per-address throttles | The endpoint can't be used to flood someone with texts |
| "Send me a code" gives the **same answer** whether or not the number has an account | It can't be used to find out who is registered |
| **Staff numbers are never texted**, and a code for one is refused | SMS is too weak a factor for operator or admin access |
| An **inactive** customer is not texted | |

### A number that is already on a password account

Registration never proved that a phone number belonged to the person who typed it, so an SMS alone
doesn't hand over an existing password account:

1. The code checks out, but the account has a password and its number was never proven →
   **409 `password_required`**, with a short-lived signed `phone_proof`.
2. The customer signs in once with email and password, sending that proof along
   (`POST /auth/login/ {…, "phone_proof": "…"}`).
3. The number is marked proven. From then on a code is all they need.

The browser keeps the proof in `sessionStorage` for that tab (never in a URL), and the sign-in page
opens on the email tab with an explanation.

## Phone-only accounts

* **E-mail is optional.** They can add one in their profile to get e-mail copies of tickets.
* **The phone number can't be changed in the profile** — it is their only way in — so support
  changes it. (Accounts with a password can change theirs; the new number must be proven again.)
* **The name comes from the first passenger** they book for, and can be edited later.
* **Paying with PayHere** needs an e-mail on the checkout form: the account's, else the first
  passenger's, else `PAYMENT_FALLBACK_EMAIL`.

## Configuration

| Variable | Default | |
|----------|---------|-|
| `SMS_BACKEND` | `console` in debug, else empty | Without a working backend, phone sign-in answers 503 and the page points to email — see [notifications.md](notifications.md) |
| `PHONE_CODE_TTL_MINUTES` | `5` | |
| `PHONE_CODE_MAX_ATTEMPTS` | `5` | |
| `PHONE_CODE_RESEND_SECONDS` | `60` | |
| `PHONE_CODE_MAX_PER_HOUR` | `5` | |
| `THROTTLE_RATE_PHONE_CODE` | `5/min` | Per address |
| `THROTTLE_RATE_PHONE_VERIFY` | `10/min` | Per address |

## Events logged

`auth.phone_code_sent`, `auth.phone_code_withheld` (a staff or inactive number),
`auth.phone_code_rejected`, `auth.registered` with `method=phone`, `auth.login` with
`method=phone`, and `auth.phone_linked`. Phone numbers in these events are masked
(`+9477*****67`); codes never appear.
