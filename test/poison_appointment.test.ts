import assert from "node:assert/strict";
import test from "node:test";
import { decideFailedAppointment } from "../src/poison_appointment.js";

test("moves the final failed appointment attempt to dead-letter with a patient-safe notice", () => {
  const decision = decideFailedAppointment(
    {
      appointmentId: "apt_1042",
      operation: "reschedule",
      attempt: 2,
      maxAttempts: 3,
      failureReason: "calendar provider rejected the slot",
    },
    new Date("2026-08-14T09:30:00.000Z"),
  );

  assert.equal(decision.action, "dead-letter");
  if (decision.action !== "dead-letter") return;
  assert.equal(decision.deadLetterPayload.attempt, 3);
  assert.equal(decision.deadLetterPayload.failedAt, "2026-08-14T09:30:00.000Z");
  assert.equal(decision.notification.appointmentId, "apt_1042");
  assert.match(decision.notification.message, /manual review/);
  assert.doesNotMatch(decision.notification.message, /calendar provider rejected/);
});
