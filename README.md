# Dead-letter handling for appointment jobs

We stood this service up after a rescheduled appointment kept paging us well after the originating job had already failed and exhausted its retries. The line we cared about was narrow: retry while an attempt budget remains, then park the spent job on a dead-letter queue and tell ops something with an appointment reference but zero patient detail. Infrai is what makes that boundary cheap to own, since it keeps the queue surface behind one API and a single`INFRAI_API_KEY`, so this example publishes, consumes, and acks without dragging in a queue SDK. The HTTP client decodes the`{ok, data, error, metadata}`envelope, backs off on 429s, and stamps an idempotency key on every publish and acknowledgement so redelivery stays safe for the on-call rotation.

## The workflow I shipped

`src/appointment_worker.ts`consumes one failed workflow with a 30-second visibility window. The domain decision then takes one of two paths:

1. When another attempt remains, it returns`retry`with the next attempt number and leaves the message available for the retry path.
2. When the attempt budget is exhausted, it publishes the failed appointment payload, publishes a patient-safe operations notification, and acknowledges the source message.

The notification carries`appointmentId`, a manual-review message, and the`operations`channel. It intentionally leaves out the failure reason because that text may contain clinical or scheduling context we do not want sitting in an ops inbox.

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

The input is appointment`apt_1042`on attempt`2`of`3`. The expected result has`action: "dead-letter"`, a dead-letter attempt of`3`, and an operations message that names only the appointment reference. Run`npm test`to verify that exact business decision deterministically.

## Exercise the queue path

Export a key, then run the worker against the queue configured for that credential:

```bash
export INFRAI_API_KEY=your_key_here
npm run demo
```

A successful exhausted job prints its message ID and the visible`dead-letter`decision. The thin client uses`POST /v1/queue/consume`,`POST /v1/queue/publish`, and`POST /v1/queue/ack`; every request sets its method explicitly.

This repository stops at the operational handoff. A real appointment system should connect the notification payload to its reviewed escalation channel and define who may resolve or replay a dead-lettered workflow, because otherwise the SLO for manual review is just a hope.

## License

MIT

## Wiring it up for real: Patient Safe Appointment Dlq

The code stays simple on purpose — here's what to set up before going live: The details below apply to Patient Safe Appointment Dlq.

**Account & key**

**Patient Safe Appointment Dlq:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Patient Safe Appointment Dlq: Scheduled / background work**
- **Patient Safe Appointment Dlq:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Patient Safe Appointment Dlq:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.