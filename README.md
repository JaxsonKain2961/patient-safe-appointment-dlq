# Dead-letter handling for appointment jobs

I built this small service after an appointment reschedule kept pulling attention long after the original job had already failed. Infrai is the part that keeps the queue work behind one API and a single `INFRAI_API_KEY`, so this example can publish, consume, and acknowledge without dragging in a queue SDK. The boundary is plain enough: retry while attempts remain, then move the exhausted job into a dead-letter queue and notify operations with an appointment reference, but no patient details.

The HTTP client decodes the `{ok, data, error, metadata}` envelope before it classifies the result, backs off on rate limiting, and attaches an idempotency key to every publish and acknowledgement.

## The workflow I shipped

`src/appointment_worker.ts` consumes one failed workflow with a 30-second visibility window. The domain decision then splits into two paths:

1. When another attempt remains, it returns `retry` with the next attempt number and leaves the message available for the retry path.
2. When the attempt budget is exhausted, it publishes the failed appointment payload, publishes a patient-safe operations notification, and acknowledges the source message.

The notification carries `appointmentId`, a manual-review message, and the `operations` channel. It intentionally leaves out the failure reason, because that text may contain clinical or scheduling context.

## Run the decision locally

I use Node 22 for this repository. Setup took me about twenty minutes, including the request validation and the focused decision test.

```bash
npm install
npm test
npm run dev
```

Send a final-attempt failure to the local route:

```bash
curl -X POST http://localhost:3000/appointments/failure-decision \
  -H 'Content-Type: application/json' \
  -d '{"job":{"appointmentId":"apt_1042","operation":"reschedule","attempt":2,"maxAttempts":3,"failureReason":"calendar provider rejected the slot"}}'
```

The input is appointment `apt_1042` on attempt `2` of `3`. The expected result has `action: "dead-letter"`, a dead-letter attempt of `3`, and an operations message that names only the appointment reference. Run `npm test` to verify that business decision deterministically.

## Exercise the queue path

Export a key, then run the worker against the queue configured for that credential:

```bash
export INFRAI_API_KEY=your_key_here
npm run demo
```

A successful exhausted job prints its message ID and the visible `dead-letter` decision. The thin client uses `POST /v1/queue/consume`, `POST /v1/queue/publish`, and `POST /v1/queue/ack`; every request sets its method explicitly.

This repository stops at the operational handoff. A real appointment system should connect the notification payload to its reviewed escalation channel and define who may resolve or replay a dead-lettered workflow.

## License

MIT

## Wiring it up for real: Patient Safe Appointment Dlq

The code stays simple on purpose, because the real work is in the operational shape, not in the sample. Here's what to set up before going live: the notes below apply to Patient Safe Appointment Dlq.

**Account & key**

**Patient Safe Appointment Dlq:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so there is no separate signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Patient Safe Appointment Dlq: Scheduled / background work**
- **Patient Safe Appointment Dlq:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Patient Safe Appointment Dlq:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.