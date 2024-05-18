const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const axios = require("axios");
const amqp = require("amqplib/callback_api");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.static("public"));

let orderBooks = {};
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

let channel = null;
amqp.connect(RABBITMQ_URL, function (error0, connection) {
  if (error0) {
    console.error("Failed to connect to RabbitMQ:", error0);
    throw error0;
  }
  connection.createChannel(function (error1, ch) {
    if (error1) {
      console.error("Failed to create a channel in RabbitMQ:", error1);
      throw error1;
    }
    const orderQueue = "order_updates";
    const priceQueue = "price_updates";
    ch.assertQueue(orderQueue, { durable: false });
    ch.assertQueue(priceQueue, { durable: false });
    channel = ch;

    ch.consume(orderQueue, (msg) => {
      const update = JSON.parse(msg.content.toString());
      const { pair, data } = update;
      if (orderBooks[pair]) {
        orderBooks[pair] = { ...orderBooks[pair], ...data };
        io.to(pair).emit("orderUpdate", data);
      }
      ch.ack(msg);
    });
  });
});

async function fetchInitialData() {
  try {
    const response = await axios.get("http://json-server:3000/cryptoPairs");
    console.log("Response from json-server:", response.data);
    if (response.data) {
      orderBooks = response.data;
    } else {
      throw new Error("Data fetched is incorrect or undefined");
    }
  } catch (error) {
    console.error("Failed to fetch initial data from json-server:", error);
    throw error;
  }
}

async function initializeServer() {
  await fetchInitialData();
  server.listen(3001, () => {
    console.log("Socket.IO server running at http://localhost:3001/");
  });

  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    socket.on("subscribe", (pair) => {
      socket.join(pair);
      console.log(`Client ${socket.id} subscribed to ${pair}`);
      if (orderBooks[pair]) {
        // Emit current prices (both buy and sell orders)
        socket.emit("priceUpdate", orderBooks[pair]);
      }
    });
  });
}

initializeServer().catch((error) => {
  console.error("Server initialization failed:", error);
});
