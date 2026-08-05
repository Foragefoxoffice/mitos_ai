const timestamp = () => new Date().toISOString();

const info = (...args) => console.log(`[${timestamp()}] INFO`, ...args);
const warn = (...args) => console.warn(`[${timestamp()}] WARN`, ...args);
const error = (...args) => console.error(`[${timestamp()}] ERROR`, ...args);

module.exports = { info, warn, error };
