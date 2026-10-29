import { createDb } from '../src/db.js';
import 'dotenv/config';

const db = createDb(process.env.DATABASE_URL ?? 'postgresql://auralis:auralis_local_only@localhost:5432/auralis');
try {
  await db.news.upsert({
    where: { slug: 'welcome-to-auralis' },
    create: { slug: 'welcome-to-auralis', title: 'Добро пожаловать в Auralis', excerpt: 'Ваш мир начинается здесь.', body: 'Auralis объединяет профили Minecraft Java Edition, управление памятью и пять визуальных тем. Для игры необходима собственная лицензия Minecraft.' },
    update: {},
  });
  console.log('News seed complete');
} finally { await db.$disconnect(); }
