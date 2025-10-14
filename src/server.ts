import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import prisma from "./prisma.js";
import { createJWT, protect } from "./middleware.js";
import http from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

app.get("/", async (req, res) => {
  res.send("Hoop Backend running 🏀");
});

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return res.status(400).json({ message: "User already exists" });
  }

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: password,
      },
    });
    const token = createJWT(user);
    return res
      .status(201)
      .json({ message: "User created successfully", token });
  } catch (e) {
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (!existingUser || existingUser.passwordHash !== password) {
    return res.status(400).json({ message: "Incorrect Credentials" });
  }

  const token = createJWT(existingUser);
  return res
    .status(200)
    .json({ message: "User signed in successfully", token });
});

function getCode(): number {
  return 100000 + Math.floor(Math.random() * 900000);
}

app.get("/create", protect, async (req, res) => {
  const code = getCode();
  const stringCode = code.toString();
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const room = await prisma.room.create({
    data: {
      code: stringCode,
      player1Id: req.user.id,
    },
  });
  res.json({ code });
});

io.on("connection", (socket) => {
  console.log("User connected");
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
