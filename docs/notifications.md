# Tickets by SMS and e-mail

The moment a booking is paid, everyone on it gets the ticket: a text message to every phone
number on the booking, and an e-mail (with the PDF attached) to every e-mail address. A few hours
before the bus leaves, the phones get a reminder. A customer who lost the text can ask for it
again at **Find my booking**.

## What a passenger receives

**The ticket text** — one or two SMS parts, in plain GSM characters so it isn't billed as UCS-2:

```
Yathra booking YT9985XZ4W is confirmed.
Kottawa to Galle, Sun 13 Sep. Board at Makumbura Multimodal Centre, 2:30 PM.
Seat 31. Bus NC-7810.
Ticket: https://yathra.lk/t/5Flcq_FcdUdSBs8z44A5QA
```

**The reminder**, `TRIP_REMINDER_HOURS` (3) before the passenger's own boarding time:

```
Yathra reminder: your bus to Galle leaves Makumbura Multimodal Centre at 2:30 PM today.
Seat 31. Bus NC-7810. Booking YT9985XZ4W.
Ticket: https://yathra.lk/t/5Flcq_FcdUdSBs8z44A5QA
```

Someone who books *inside* that window isn't reminded — their ticket has only just arrived. No
reminder goes to an unpaid or cancelled booking, a cancelled trip, or a bus that has already left.

**The e-mail** repeats the journey, lists every passenger and seat, links to the ticket and
attaches the PDF.

| Who | Text | E-mail |
|-----|:----:|:------:|
| The account holder | ✓ (their phone) | ✓ (if the account has one) |
| Each passenger | ✓ (each number once) | ✓ (if they gave one — it's optional) |

## The ticket link

Every ticket has its own link, `/t/<code>`, where the code is 16 random bytes (22 characters,
far beyond guessing). It opens **without signing in**, because the person travelling is often not
the person who booked. That is why it shows only the journey, the passengers' names and seats, and
the QR code — no phone numbers, e-mails, prices or payment details — and why it is served with
`Cache-Control: private, no-store` and `noindex`. A cancelled booking's link says it's cancelled.

Signed-in customers get the same link from **Share ticket** on their ticket page (the phone's share
sheet, so it can go straight to WhatsApp).

## Find my booking

`/find-booking` asks for the booking reference and a phone number **that is already on the
booking**. The ticket is texted to that number; nothing is shown on screen. The answer is word for
word the same whether or not anything matched, so the page can't be used to check references or
phone numbers. A phone can ask again only once every two minutes, and the endpoint is rate-limited
per address (`THROTTLE_RATE_TICKET_FIND`, 5/min).

## How sending works

```
payment confirmed ──► rows written in the SAME transaction ──► commit ──► sent in the background
                                                                              │
                                    send_notifications (every minute) ◄───────┘ anything that failed
```

* **Nothing is lost, nothing is doubled.** Messages are written in the transaction that confirms
  the booking. Each ticket message has a unique key per booking and recipient, so a payment
  notification delivered twice still sends one ticket.
* **Nothing is sent for a booking that didn't commit** — and a message queued for a booking that
  has since been cancelled is skipped at send time.
* **A message is claimed before it is sent** (with a lock that runs out), so the immediate send
  and the worker can never both deliver it.
* **Failures retry** after 1, 5, 15 and 60 minutes; a refusal from the gateway (a bad number) is
  final. After `NOTIFICATION_MAX_ATTEMPTS` the message stays *failed*.
* **Every message is logged** in the `Notification` table (Django admin → *Text messages and
  e-mails*) with its status, attempts and the gateway's message id. Sign-in codes are logged as
  sent but their text is never stored.

## Setting up SMS (Notify.lk)

1. Create an account at [notify.lk](https://notify.lk) and top it up.
2. Ask Notify.lk to approve a **sender ID** (e.g. `Yathra`). Their demo sender `NotifyDEMO` works
   for testing tickets, but **must not be used for sign-in codes** — accounts get suspended for it.
3. Set:

```bash
SMS_BACKEND=notifylk
SMS_SENDER_ID=Yathra
NOTIFYLK_USER_ID=...        # from the Notify.lk settings page
NOTIFYLK_API_KEY=...        # secret
```

Other gateways (Dialog, Mobitel, Text.lk) are one small class each in `apps/notifications/sms.py`.

| `SMS_BACKEND` | What happens |
|---------------|--------------|
| `notifylk` | Real texts |
| `console` | Texts are written to the log (development default). **Production refuses to start** with it, because sign-in codes would land in the logs; staging may, via `ALLOW_CONSOLE_SMS`. |
| *(empty)* | Texts are off: ticket texts are recorded as *not sent*, and phone sign-in answers "unavailable" |

## Setting up e-mail

One URL: `EMAIL_URL=smtp+tls://user:password@smtp.example.com:587` (any SMTP service — Amazon
SES, Mailgun, Google Workspace). `consolemail://` prints e-mails (development default);
`dummymail://` switches e-mail off (production default until you set it). Set
`DEFAULT_FROM_EMAIL` to an address on a domain with SPF/DKIM set up, or tickets will land in spam.

## The scheduled job

```bash
python manage.py send_notifications     # every minute
```

It queues the reminders that are due and sends everything waiting or due a retry. It is safe to
run as often as you like. `--skip-reminders` only sends.

## Cost

Each ticket is one text per distinct phone on the booking, plus one reminder each. A typical
booking — one or two numbers — costs two to four SMS parts.
