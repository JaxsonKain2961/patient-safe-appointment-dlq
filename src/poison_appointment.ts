import { z } from "zod";

export const appointmentJobSchema = z.object({
  appointmentId: z.string().min(1),
  operation: z.enum(["confirm", "reschedule", "cancel"]),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  failureReason: z.string().min(1),
});

export type AppointmentJob = z.infer<typeof appointmentJobSchema>;

export type JobDecision =
  | { action: "retry"; nextAttempt: number }
  | {
      action: "dead-letter";
      deadLetterPayload: AppointmentJob & { failedAt: string };
      notification: { appointmentId: string; message: string; channel: "operations" };
    };

export function decideFailedAppointment(job: AppointmentJob, now: Date): JobDecision {
  const nextAttempt = job.attempt + 1;
  if (nextAttempt < job.maxAttempts) return { action: "retry", nextAttempt };

  return {
    action: "dead-letter",
    deadLetterPayload: { ...job, attempt: nextAttempt, failedAt: now.toISOString() },
    notification: {
      appointmentId: job.appointmentId,
      channel: "operations",
      message: `Appointment workflow ${job.appointmentId} needs manual review. No patient details are included.`,
    },
  };
}
