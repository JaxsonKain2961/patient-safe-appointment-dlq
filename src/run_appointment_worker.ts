import { processNextFailedAppointment } from "./appointment_worker.js";

const result = await processNextFailedAppointment();
console.log(result ? JSON.stringify(result, null, 2) : "No appointment job is ready.");
