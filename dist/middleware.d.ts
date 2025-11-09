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
export declare const createJWT: (user: User) => string;
export declare const protect: (req: Request, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=middleware.d.ts.map