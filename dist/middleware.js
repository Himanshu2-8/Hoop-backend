"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protect = exports.createJWT = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const createJWT = (user) => {
    return jsonwebtoken_1.default.sign({ name: user.name, email: user.email, id: user.id }, process.env.JWT_SECRET);
};
exports.createJWT = createJWT;
const protect = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        res.status(401).json({ message: "Unauthorized" });
        return;
    }
    try {
        const user = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = user;
        next();
    }
    catch (e) {
        console.error("JWT verification failed:", e);
        res.status(401).json({ message: "Unauthorized" });
    }
};
exports.protect = protect;
//# sourceMappingURL=middleware.js.map