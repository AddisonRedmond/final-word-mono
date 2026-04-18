import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { LobbyRegistry, type Connection } from "./ws/lobbyRegistry.js";
import { routeMessage } from "./ws/router.js";
import { parseMessage, serializeMessage } from "types/ws.js";
import type { ServerMessage } from "types/ws.js";

const app = new Hono();
const registry = new LobbyRegistry();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get(
  "/ws",
  authMiddleware,
  upgradeWebSocket((c) => {
    const uid = c.get("uid") as string;
    let conn: Connection;

    return {
      onOpen(_evt, ws) {
        conn = { uid, ws };
      },
      onMessage(event, ws) {
        try {
          const msg = parseMessage(event.data as string);
          const result = routeMessage(msg as ServerMessage, conn, registry);
          if (result !== null) {
            ws.send(serializeMessage(result));
          }
        } catch {
          ws.send(
            serializeMessage({ type: "error", reason: "invalid_message" }),
          );
        }
      },
      onClose() {
        registry.removeAll(conn);
      },
    };
  }),
);

const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT) || 4200,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

injectWebSocket(server);
