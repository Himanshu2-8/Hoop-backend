import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import prisma from "./prisma.js";
import { createJWT, protect } from "./middleware.js";
import http from "http";
import { Server } from "socket.io";
import axios from "axios";
import { RoomStatus } from "./generated/prisma/index.js";

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

interface Questions {
  question: string,
  correctAnswer: string,
  incorrectAnswers: string[];
}

const fetchQuestions = async () => {
  const response = await axios.get("https://opentdb.com/api.php?amount=10&category=21&difficulty=easy&type=multiple");
  const data = response.data.results;
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
  player1Answered: boolean;
  player2Answered: boolean;
}

const gameStates = new Map<string, GameState>();

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

  socket.on("game_start", async ({ code }) => {
    const room = await prisma.room.findUnique({ where: { code } });
    if (!room) {
      return socket.emit("error", { message: "Room not found" });
    }
    if (room.status == RoomStatus.STARTED) {
      return socket.emit("error", { message: "Game already started" });
    }

    const questions = await fetchQuestions();

    gameStates.set(code, {
      questions: questions,
      currentQuestion: 0,
      player1Score: 0,
      player2Score: 0,
      player1Answered: false,
      player2Answered: false,
    })

    const updatedRoom = await prisma.room.update({
      where: { code },
      data: { status: RoomStatus.STARTED },
    })
    io.to(code).emit("game_started", {
      question: questions[0],
      questionNumber: 1,
      player1Score: 0,
      player2Score: 0,
    });
  })
  socket.on("submit_answer", async ({ code, answer, userId }) => {
    const room = await prisma.room.findUnique({ where: { code } });
    if (!room) {
      return socket.emit("error", { message: "Room not found" });
    }
    if (room.status == RoomStatus.WAITING) {
      return socket.emit("error", { message: "Game not started" });
    }
    const game = gameStates.get(code);
    if (!game) {
      return socket.to(code).emit("error", { message: "Game not found" });
    }
    const currentQ = game.questions[game.currentQuestion];
    if (!currentQ) {
      return socket.emit("error", { message: "Question not found" });
    }

    const isCorrect = answer === currentQ.correctAnswer;

    if (room.player1Id === userId) {
      if (game.player1Answered) {
        return socket.emit("error", { message: "Already answered" });
      }
      game.player1Answered = true;
      if (isCorrect) game.player1Score++;
    } else if (room.player2Id === userId) {
      if (game.player2Answered) {
        return socket.emit("error", { message: "Already answered" });
      }
      game.player2Answered = true;
      if (isCorrect) game.player2Score++;
    }
    socket.emit("answered", {
      isCorrect,
      answer: currentQ.correctAnswer,
    })

    if (game.player1Answered && game.player2Answered) {
      io.to(code).emit("scores_updates", {
        player1Score: game.player1Score,
        player2Score: game.player2Score,
      })
    }

    game.currentQuestion++;
    game.player1Answered = false;
    game.player2Answered = false;

    if (game.currentQuestion < game.questions.length) {
      setTimeout(() => {
        io.to(code).emit("next_question", {
          question: game.questions[game.currentQuestion],
          questionNumber: game.currentQuestion + 1,
          totalQuestions: game.questions.length,
        });
      }, 2000);
    } else {
      let winner: string = game.player1Score > game.player2Score ? room.player1Id as string : room.player2Id as string
      if (game.player1Score == game.player2Score) winner = "tie";
      io.to(code).emit("game_over", {
        player1Score: game.player1Score,
        player2Score: game.player2Score,
        winner,
      });
    }

    const dbPlayer1score = await prisma.user.findUnique({ where: { id: room.player1Id as string, highestScore: game.player1Score } })
    const dbPlayer2score = await prisma.user.findUnique({ where: { id: room.player2Id as string, highestScore: game.player2Score } })

    if (!dbPlayer1score) {
      await prisma.user.update({
        where: { id: room.player1Id as string },
        data: { highestScore: game.player1Score },
      })
    }

    if (dbPlayer1score && game.player1Score > dbPlayer1score.highestScore) {
      await prisma.user.update({
        where: { id: room.player1Id as string },
        data: { highestScore: game.player1Score },
      });
    }

    if (!dbPlayer2score) {
      await prisma.user.update({
        where: { id: room.player2Id as string },
        data: { highestScore: game.player2Score },
      })
    }

    if (dbPlayer2score && game.player2Score > dbPlayer2score.highestScore) {
      await prisma.user.update({
        where: { id: room.player2Id as string },
        data: { highestScore: game.player2Score },
      });
    }

    let winner = '';
    if (game.player1Score > game.player2Score) {
      winner = 'Player 1';
    } else if (game.player2Score > game.player1Score) {
      winner = 'Player 2';
    } else {
      winner = 'It\'s a tie!';
    }

    gameStates.delete(code);
    await prisma.room.update({
      where: { code },
      data: { status: RoomStatus.FINISHED },
    });

    console.log(`🏁 Game finished in room ${code}. ${winner}`);

  })

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
