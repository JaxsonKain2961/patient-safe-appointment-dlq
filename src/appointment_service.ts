import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError } from "./infrai_queue.js";
import { appointmentJobSchema, decideFailedAppointment } from "./poison_appointment.js";

const requestSchema = z.object({
  job: appointmentJobSchema,
});

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/appointments/failure-decision") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    send(response, 200, decideFailedAppointment(input.job, new Date()));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "Invalid appointment failure body" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }
    send(response, 500, { error: "Appointment failure decision could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Appointment decision service listening on http://localhost:${port}`));
