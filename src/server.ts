import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import prisma from "./prisma.js";
import { createJWT, protect } from "./middleware.js";
import http from "http";
import { Server } from "socket.io";
import axios from "axios";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Your frontend URL
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

interface Questions{
  question:string,
  correctAnswer:string,
  incorrectAnswers: string[];
}

const fetchQuestions=async()=>{
  const response=await axios.get("https://opentdb.com/api.php?amount=10&category=21&difficulty=easy&type=multiple");
  const data=response.data.results;
  const questions: Questions[] = data.map((question: any) => ({
    question: question.question,
    correctAnswer: question.correct_answer,
    incorrectAnswers: question.incorrect_answers,
  }));
  return questions;
}

interface GameState {
  questions: Questions[];
  currentQuestion: number;
  player1Score: number;
  player2Score: number;
}

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
  console.log("🟢 New socket connected:", socket.id);

  socket.on("join_room", async ({ code, userId }) => {
    try {
      const room = await prisma.room.findUnique({ where: { code } });

      if (!room) {
        return socket.emit("error", { message: "Room not found" });
      }

      if (room.player1Id === userId) {
        socket.join(code);
        socket.emit("waiting", { message: "Waiting for opponent to join" });
        console.log(`Host ${userId} re-joined socket room ${code}`);
        return;
      }

      if (room.player2Id) {
        return socket.emit("roomFull", {
          message: "Room already has 2 players",
        });
      }

      const result = await prisma.room.updateMany({
        where: { code, player2Id: null },
        data: { player2Id: userId },
      });

      if (result.count === 0) {
        socket.emit("roomFull", { message: "Room is already full" });
        console.log(
          `Join failed — player2 slot already taken for room ${code}`,
        );
        return;
      }

      socket.join(code);

      const updatedRoom = await prisma.room.findUnique({ where: { code } });

      io.to(code).emit("roomReady", {
        message: "Both players connected — game can start",
        room: updatedRoom,
      });

      console.log(`✅ Player ${userId} joined room ${code}`);
    } catch (error) {
      console.error("Join room error:", error);
      socket.emit("error", { message: "Error joining room" });
    }
  });


  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
