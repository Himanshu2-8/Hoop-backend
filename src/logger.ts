// For now, this is a simple wrapper around console.
// In a real production app, you would use a structured logger like pino or winston.
export const logger = {
  info: (...args: any[]) => {
    console.log(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
};
