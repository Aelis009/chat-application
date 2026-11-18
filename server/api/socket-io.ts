import "dotenv/config";
import { createServer } from "node:http";
import { createRealtime } from "../realtime";

// Vercel serves this file at /api/socket-io. Socket.IO appends /socket.io,
// so the browser connects to /api/socket-io/socket.io with the /private
// namespace.
const httpServer = createServer();

createRealtime(httpServer);

export default httpServer;
