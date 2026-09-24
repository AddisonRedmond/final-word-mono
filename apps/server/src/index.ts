import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Server } from "socket.io";
import "dotenv/config";
import logger from "./utils/logger.js";
import { installSocketAuth } from "./socket/auth.js";
import { registerGames } from "./games/registry.js";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

const port = Number(process.env.PORT ?? 4200);
const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    logger.info(`Server is running on http://localhost:${info.port}`);
  },
);

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: [
      "https://finalword.io",
      "https://www.finalword.io",
      "http://localhost:3000",
    ],
  },
});

// Authenticate every socket before any game handlers run.
installSocketAuth(io);

// Wire up all registered games (see games/registry.ts to add more).
registerGames(io);
