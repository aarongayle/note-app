"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { getStroke } from "perfect-freehand";

// Re-implement drawing logic since we can't easily import from src/
function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return "";

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );

  d.push("Z");
  return d.join(" ");
}

function getStrokeOutline(points: number[][], options: any = {}) {
  return getStroke(points, {
    size: options.size ?? 3,
    thinning: options.thinning ?? 0.5,
    smoothing: options.smoothing ?? 0.5,
    streamline: options.streamline ?? 0.5,
    simulatePressure: options.simulatePressure ?? false,
    ...options,
  });
}

function renderStroke(stroke: any) {
  const outline = getStrokeOutline(stroke.points, stroke.options);
  return getSvgPathFromStroke(outline);
}

const CHUNK_SIZE = 500;
const OVERLAP = 100;
const STEP = CHUNK_SIZE - OVERLAP;

export const transcribeNote = internalAction({
  args: { noteId: v.id("noteItems") },
  handler: async (ctx, args) => {
    const strokes = await ctx.runQuery(internal.transcriptionTasks.getNoteStrokes, {
      noteId: args.noteId,
    });

    if (!strokes || strokes.length === 0) return;

    // Determine bounding box of all strokes
    let globalMinY = Infinity;
    let globalMaxY = -Infinity;
    let globalMinX = Infinity;
    let globalMaxX = -Infinity;

    for (const stroke of strokes) {
      for (const [x, y] of stroke.points) {
        if (y < globalMinY) globalMinY = y;
        if (y > globalMaxY) globalMaxY = y;
        if (x < globalMinX) globalMinX = x;
        if (x > globalMaxX) globalMaxX = x;
      }
    }

    if (globalMinY === Infinity) return;

    // Add some padding
    globalMinX -= 50;
    globalMaxX += 50;
    const width = Math.max(globalMaxX - globalMinX, 100); // ensure positive width

    const transcriptions = [];

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // Process in chunks
    for (let y = globalMinY; y < globalMaxY; y += STEP) {
      const chunkStartY = y;
      const chunkEndY = y + CHUNK_SIZE;

      // Find strokes that intersect this chunk
      const intersectingStrokes = strokes.filter((stroke: any) => {
        let strokeMinY = Infinity;
        let strokeMaxY = -Infinity;
        for (const [px, py] of stroke.points) {
          if (py < strokeMinY) strokeMinY = py;
          if (py > strokeMaxY) strokeMaxY = py;
        }
        // Check intersection
        return strokeMinY <= chunkEndY && strokeMaxY >= chunkStartY;
      });

      if (intersectingStrokes.length === 0) continue;

      // Generate SVG for this chunk
      let svgPaths = "";
      for (const stroke of intersectingStrokes) {
        const pathData = renderStroke(stroke);
        // We use the stroke's color or default to black. 
        // For transcription, black is fine.
        svgPaths += `<path d="${pathData}" fill="black" />`;
      }

      // We use a viewBox that matches the chunk's area so the strokes are positioned correctly
      const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="${globalMinX} ${chunkStartY} ${width} ${CHUNK_SIZE}" width="${width}" height="${CHUNK_SIZE}">
          <rect x="${globalMinX}" y="${chunkStartY}" width="${width}" height="${CHUNK_SIZE}" fill="white" />
          ${svgPaths}
        </svg>
      `;

      try {
        // Convert SVG to PNG
        const pngBuffer = await sharp(Buffer.from(svgString))
          .png()
          .toBuffer();

        // Send to Gemini
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-preview',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: pngBuffer.toString("base64"),
                    mimeType: "image/png",
                  },
                },
                {
                  text: `You are a note transcribing bot. You look at handwritten notes and you transcribe them. Sometimes there will be text, handwritten, in the notes. Sometimes there will be hand drawn images or diagrams. Your job is to transcribe them. Your output will be used for searching the handwritten notes, so be thorough.

Do not include words that are not in the drawing. Words like "This image includes the text..." will throw off our search techniques because they will falsely find the words "image," "includes," "text," etc. Output only the transcribed text. If there is no text, output nothing.`,
                },
              ],
            },
          ],
        });

        const text = response.text;
        if (text && text.trim().length > 0) {
          transcriptions.push({
            text: text.trim(),
            startY: chunkStartY,
            endY: chunkEndY,
          });
        }
      } catch (error) {
        console.error("Error processing chunk for note", args.noteId, error);
      }
    }

    // Save transcriptions
    await ctx.runMutation(internal.transcriptionTasks.saveTranscriptions, {
      noteId: args.noteId,
      transcriptions,
    });
  },
});
