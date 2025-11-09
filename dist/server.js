"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = __importDefault(require("./prisma"));
const middleware_1 = require("./middleware");
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const helmet_1 = __importDefault(require("helmet"));
const logger_1 = __importDefault(require("./logger"));
dotenv_1.default.config();
const { PORT, CORS_ORIGIN, SPORTS_API, JWT_SECRET } = process.env;
if (!PORT || !CORS_ORIGIN || !SPORTS_API || !JWT_SECRET) {
    logger_1.default.error("Missing required environment variables");
    process.exit(1);
}
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true,
    },
});
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: CORS_ORIGIN }));
app.use(express_1.default.json());
const fetchQuestions = async () => {
    const response = await axios_1.default.get(SPORTS_API);
    const data = response.data.results;
    const questions = data.map((question) => ({
        question: question.question,
        correctAnswer: question.correct_answer,
        incorrectAnswers: question.incorrect_answers,
    }));
    return questions;
};
const gameStates = new Map();
app.get("/", async (req, res) => {
    res.send("Hoop Backend running 🏀");
});
app.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;
    const existingUser = await prisma_1.default.user.findUnique({
        where: { email },
    });
    if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
    }
    try {
        const user = await prisma_1.default.user.create({
            data: {
                name,
                email,
                passwordHash: password,
            },
        });
        const token = (0, middleware_1.createJWT)(user);
        return res
            .status(201)
            .json({ message: "User created successfully", token });
    }
    catch (e) {
        logger_1.default.error(e, "Error creating user");
        return res.status(500).json({ message: "Internal server error" });
    }
});
app.post("/signin", async (req, res) => {
    const { email, password } = req.body;
    const existingUser = await prisma_1.default.user.findUnique({
        where: { email },
    });
    if (!existingUser || existingUser.passwordHash !== password) {
        return res.status(400).json({ message: "Incorrect Credentials" });
    }
    const token = (0, middleware_1.createJWT)(existingUser);
    return res
        .status(200)
        .json({ message: "User signed in successfully", token });
});
function getCode() {
    return 100000 + Math.floor(Math.random() * 900000);
}
app.get("/create", middleware_1.protect, async (req, res) => {
    const code = getCode();
    const stringCode = code.toString();
    if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const room = await prisma_1.default.room.create({
        data: {
            code: stringCode,
            player1Id: req.user.id,
        },
    });
    res.json({ code: stringCode });
});
io.on("connection", (socket) => {
    logger_1.default.info(`🟢 New socket connected: ${socket.id}`);
    socket.on("join_room", async ({ code, userId }) => {
        try {
            const room = await prisma_1.default.room.findUnique({ where: { code } });
            if (!room) {
                return socket.emit("error", { message: "Room not found" });
            }
            if (room.player1Id === userId) {
                socket.join(code);
                socket.emit("waiting", { message: "Waiting for opponent to join" });
                logger_1.default.info(`Host ${userId} re-joined socket room ${code}`);
                return;
            }
            if (room.player2Id) {
                return socket.emit("roomFull", {
                    message: "Room already has 2 players",
                });
            }
            const result = await prisma_1.default.room.updateMany({
                where: { code, player2Id: null },
                data: { player2Id: userId },
            });
            if (result.count === 0) {
                socket.emit("roomFull", { message: "Room is already full" });
                logger_1.default.warn(`Join failed — player2 slot already taken for room ${code}`);
                return;
            }
            const updatedRoom = await prisma_1.default.room.findUnique({ where: { code } });
            // Emit to the joining player first
            socket.emit("room_ready", {
                message: "Both players connected — game can start",
                room: updatedRoom,
            });
            socket.join(code);
            // Then emit to the rest of the room (the host)
            socket.to(code).emit("room_ready", {
                message: "Both players connected — game can start",
                room: updatedRoom,
            });
            logger_1.default.info(`✅ Player ${userId} joined room ${code}`);
        }
        catch (error) {
            logger_1.default.error(error, "Join room error");
            socket.emit("error", { message: "Error joining room" });
        }
    });
    socket.on("game_start", async ({ code }) => {
        const room = await prisma_1.default.room.findUnique({ where: { code } });
        if (!room) {
            return socket.emit("error", { message: "Room not found" });
        }
        if (room.status == client_1.RoomStatus.STARTED) {
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
        });
        const updatedRoom = await prisma_1.default.room.update({
            where: { code },
            data: { status: client_1.RoomStatus.STARTED },
        });
        io.to(code).emit("game_started", {
            question: questions[0],
            questionNumber: 1,
            player1Score: 0,
            player2Score: 0,
        });
    });
    socket.on("submit_answer", async ({ code, answer, userId }) => {
        const room = await prisma_1.default.room.findUnique({ where: { code } });
        if (!room)
            return socket.emit("error", { message: "Room not found" });
        if (room.status === client_1.RoomStatus.WAITING) {
            return socket.emit("error", { message: "Game not started" });
        }
        const game = gameStates.get(code);
        if (!game)
            return socket.emit("error", { message: "Game not found" });
        const currentQ = game.questions[game.currentQuestion];
        if (!currentQ)
            return socket.emit("error", { message: "Question not found" });
        const isCorrect = answer === currentQ.correctAnswer;
        if (room.player1Id === userId) {
            if (game.player1Answered) {
                return socket.emit("error", { message: "Already answered" });
            }
            game.player1Answered = true;
            if (isCorrect)
                game.player1Score++;
        }
        else if (room.player2Id === userId) {
            if (game.player2Answered) {
                return socket.emit("error", { message: "Already answered" });
            }
            game.player2Answered = true;
            if (isCorrect)
                game.player2Score++;
        }
        socket.emit("answered", {
            isCorrect,
            correctAnswer: currentQ.correctAnswer,
        });
        if (game.player1Answered && game.player2Answered) {
            io.to(code).emit("scores_updated", {
                player1Score: game.player1Score,
                player2Score: game.player2Score,
            });
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
            }
            else {
                let winner;
                if (game.player1Score > game.player2Score) {
                    winner = room.player1Id;
                }
                else if (game.player2Score > game.player1Score) {
                    winner = room.player2Id;
                }
                else {
                    winner = "tie";
                }
                const player1 = await prisma_1.default.user.findUnique({
                    where: { id: room.player1Id },
                });
                const player2 = await prisma_1.default.user.findUnique({
                    where: { id: room.player2Id },
                });
                if (player1 && game.player1Score > player1.highestScore) {
                    await prisma_1.default.user.update({
                        where: { id: room.player1Id },
                        data: { highestScore: game.player1Score },
                    });
                }
                if (player2 && game.player2Score > player2.highestScore) {
                    await prisma_1.default.user.update({
                        where: { id: room.player2Id },
                        data: { highestScore: game.player2Score },
                    });
                }
                io.to(code).emit("game_over", {
                    player1Score: game.player1Score,
                    player2Score: game.player2Score,
                    winner,
                });
                gameStates.delete(code);
                await prisma_1.default.room.update({
                    where: { code },
                    data: { status: client_1.RoomStatus.FINISHED },
                });
                logger_1.default.info(`Game finished in room ${code}. Winner: ${winner}`);
            }
        }
    });
    socket.on("disconnect", () => {
        logger_1.default.info(`Client disconnected: ${socket.id}`);
    });
});
server.listen(PORT, () => {
    logger_1.default.info(`Server running at http://localhost:${PORT}`);
});
//# sourceMappingURL=server.js.map