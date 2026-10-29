import { createDb } from './db.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await db.$connect();
const app = createApp(db, config);
const server = app.listen(config.PORT, config.HOST, () => { console.log(`Auralis API listening on ${config.HOST}:${config.PORT}`); });
const shutdown = () => { server.close(() => { void db.$disconnect().then(() => process.exit(0)); }); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
