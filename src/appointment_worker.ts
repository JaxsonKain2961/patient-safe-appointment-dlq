import { infrai } from "./infrai_queue.js";
import { appointmentJobSchema, decideFailedAppointment, type JobDecision } from "./poison_appointment.js";

export type ProcessedJob = {
  messageId: string;
  decision: JobDecision;
};

const failedAppointmentsQueue = "appointment-failures";
const deadLetterQueue = "appointment-dead-letter";
const operationsQueue = "appointment-operations";

export async function processNextFailedAppointment(now = new Date()): Promise<ProcessedJob | null> {
  const [message] = await infrai.queue.consume(failedAppointmentsQueue, 1, 30);
  if (!message) return null;

  const job = appointmentJobSchema.parse(message.payload);
  const decision = decideFailedAppointment(job, now);

  if (decision.action === "dead-letter") {
    await infrai.queue.publish(
      deadLetterQueue,
      decision.deadLetterPayload,
      `appointment-dlq-${job.appointmentId}-${decision.deadLetterPayload.attempt}`,
    );
    await infrai.queue.publish(
      operationsQueue,
      decision.notification,
      `appointment-notice-${job.appointmentId}-${decision.deadLetterPayload.attempt}`,
    );
    await infrai.queue.ack(failedAppointmentsQueue, message.message_id);
  }

  return { messageId: message.message_id, decision };
}
