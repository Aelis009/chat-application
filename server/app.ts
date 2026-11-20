import { Hono } from "hono";
import { app as configuredApp } from "./http/app.js";

// Keep a root Hono entrypoint for Vercel's framework detection.
const app = new Hono();

app.all("*", (context) => configuredApp.fetch(context.req.raw));

export { app };
export default app;
