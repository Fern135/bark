// Opens a websocket to the ws service through the gateway (/ws/ -> ws).
// The ws service authenticates with the HttpOnly `access_token` cookie when present;
// pass `token` only if you keep the JWT somewhere else.
export function openSocket(token?: string): WebSocket {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${window.location.host}/ws/`);
  if (token) {
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token }));
    });
  }
  return socket;
}
