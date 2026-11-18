const { Server } = require("socket.io");

const io = new Server(4000, {
  cors: {
    origin: "http://localhost:3000",
  },
});

console.log("Socket.IO server running on port 4000");

io.on("connection", (socket) => {
  console.log("User Connected:", socket.id);

  socket.on("send_message", (message) => {
    console.log("Message received:", message);

    io.emit("receive_message", message);
  });

  socket.on("disconnect", () => {
    console.log("User Disconnected:", socket.id);
  });
});
