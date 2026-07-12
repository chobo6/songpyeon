import { Client } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);
