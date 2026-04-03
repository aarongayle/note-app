import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run handwriting transcription every 5 minutes
crons.interval(
  "transcribe notes",
  { minutes: 5 },
  internal.transcriptionTasks.processPendingNotes
);

export default crons;
