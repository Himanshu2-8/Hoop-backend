"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
// For now, this is a simple wrapper around console.
// In a real production app, you would use a structured logger like pino or winston.
exports.logger = {
    info: (...args) => {
        console.log(...args);
    },
    error: (...args) => {
        console.error(...args);
    },
    warn: (...args) => {
        console.warn(...args);
    },
};
//# sourceMappingURL=logger.js.map