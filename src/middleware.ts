import jwt from "jsonwebtoken";
import { type NextFunction, type Request, type Response } from "express";

declare global {
  namespace Express {
    interface Request {
      user?: JWTUser;
    }
  }
}

interface User {
  name: string | null;
  email: string;
  id: string;
  passwordHash: string | null;
  highestScore: number;
  createdAt: Date;
}

export type JWTUser = {
  name: string | null;
  email: string;
  id: string;
};

export const createJWT = (user: User) => {
  return jwt.sign(
    { name: user.name, email: user.email, id: user.id },
    process.env.JWT_SECRET as string,
  );
};

export const protect = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET as string) as JWTUser;
    req.user = user;
    next();
  } catch (e) {
    console.error("JWT verification failed:", e);
    res.status(401).json({ message: "Unauthorized" });
  }
};

