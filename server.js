const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const fs = require('node:fs/promises');
const path = require('node:path');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseName = process.env.MYSQL_DATABASE || 'dairy_farm';
const connectionConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  charset: 'utf8mb4'
};
let pool;

app.use(express.json({ limit: '1mb' }));

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function requiredText(value, field, maxLength = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    const error = new Error(`${field} is required and must be at most ${maxLength} characters`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function optionalText(value, maxLength = 1000) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    const error = new Error(`Text must be at most ${maxLength} characters`);
    error.status = 400;
    throw error;
  }
  return value.trim() || null;
}

function requiredDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${field} must use YYYY-MM-DD format`);
    error.status = 400;
    throw error;
  }
  return value;
}

function optionalDate(value) {
  return value ? requiredDate(value, 'Date') : null;
}

async function seedDemoData(db) {
  const [[{ cowCount }]] = await db.query('SELECT COUNT(*) AS cowCount FROM cows');
  if (Number(cowCount) > 0) {
    await db.execute('INSERT IGNORE INTO farm_settings (id, farm_name, owner_name, farm_code) VALUES (1, NULL, ?, ?)', ['คุณมาลี', 'BSF-001']);
    await db.execute('INSERT IGNORE INTO notification_preferences (id) VALUES (1)');
    return;
  }

  const cows = [
    ['C-001', 'นมเย็น', 'โฮลสไตน์ฟรีเชียน', 'เมีย', '2021-02-12', 'ให้นม', 32.4],
    ['C-002', 'ดอกแก้ว', 'โฮลสไตน์ฟรีเชียน', 'เมีย', '2020-08-21', 'ให้นม', 30.8],
    ['C-003', 'ดาว', 'ลูกผสม', 'เมีย', '2020-05-04', 'ให้นม', 28.6],
    ['C-008', 'มะลิ', 'โฮลสไตน์ฟรีเชียน', 'เมีย', '2018-11-14', 'ให้นม', 25.2],
    ['C-011', 'ข้าวหอม', 'บราวน์สวิส', 'เมีย', '2019-04-30', 'พักเต้า', 0],
    ['C-014', 'ใบเตย', 'โฮลสไตน์ฟรีเชียน', 'เมีย', '2019-09-05', 'ให้นม', 29.3],
    ['C-016', 'สายฝน', 'ลูกผสม', 'เมีย', '2021-06-18', 'ให้นม', 26.8],
    ['C-019', 'แก้มใส', 'โฮลสไตน์ฟรีเชียน', 'เมีย', '2022-03-10', 'โครุ่น', 0],
    ['C-021', 'น้ำผึ้ง', 'ลูกผสม', 'เมีย', '2018-12-01', 'พักเต้า', 0]
  ];
  const events = [
    ['C-014', 'สุขภาพ', 'วัคซีน', dateOffset(0), 'วัคซีนปากและเท้าเปื่อย', dateOffset(180)],
    ['C-003', 'ตั้งท้อง', 'ตรวจท้อง', dateOffset(3), 'นัดตรวจท้องหลังผสมเทียม', null],
    ['C-008', 'พักเต้า', 'พักเต้า', dateOffset(7), 'กำหนดพักเต้าก่อนคลอด 60 วัน', null],
    ['C-001', 'ผสมพันธุ์', 'ผสมเทียม', dateOffset(-7), 'ผสมเทียมรอบที่ 1', dateOffset(14)],
    ['C-011', 'สุขภาพ', 'ถ่ายพยาธิ', dateOffset(-15), 'ถ่ายพยาธิตามรอบ', dateOffset(75)]
  ];

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('INSERT INTO cows (id, name, breed, sex, birth_date, stage, avg_yield) VALUES ?', [cows]);
    await connection.query('INSERT INTO care_events (cow_id, category, event_type, event_date, note, next_date) VALUES ?', [events]);
    await connection.execute(
      'INSERT INTO farm_users (name, email, role) VALUES (?, ?, ?), (?, ?, ?)',
      ['คุณมาลี', 'mali@farm.local', 'เจ้าของฟาร์ม', 'สมชาย ใจดี', 'somchai@farm.local', 'ผู้ปฏิบัติงาน']
    );
    await connection.execute(
      'INSERT INTO milk_quality_records (record_date, scc, fat_pct, snf_pct, mb_test, income, source_file) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [dateOffset(-1), 182000, 3.65, 8.55, 'ผ่าน', 48620, 'ข้อมูลตัวอย่าง']
    );
    await connection.execute('INSERT INTO farm_settings (id, farm_name, owner_name, farm_code) VALUES (1, NULL, ?, ?)', ['คุณมาลี', 'BSF-001']);
    await connection.execute('INSERT INTO notification_preferences (id) VALUES (1)');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function initializeDatabase() {
  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('MYSQL_DATABASE may contain only letters, numbers, and underscores');
  const connection = await mysql.createConnection({ ...connectionConfig, multipleStatements: true });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database: databaseName });
    const schema = await fs.readFile(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
    await connection.query(schema);
  } finally {
    await connection.end();
  }

  pool = mysql.createPool({
    ...connectionConfig,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true,
    dateStrings: true
  });
  await seedDemoData(pool);
}

async function waitForMySql() {
  const attempts = Math.max(1, Number(process.env.MYSQL_CONNECT_ATTEMPTS || 30));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection(connectionConfig);
      await connection.end();
      return;
    } catch (error) {
      await connection?.end().catch(() => {});
      if (!['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(error.code) || attempt === attempts) throw error;
      console.log(`Waiting for MySQL (${attempt}/${attempts})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: databaseName });
}));

app.get('/api/bootstrap', asyncRoute(async (_req, res) => {
  const [cows] = await pool.query('SELECT id, name, breed, sex, birth_date AS birth, stage, avg_yield AS yield FROM cows ORDER BY id');
  const [milk] = await pool.query("SELECT id, cow_id AS cowId, DATE_FORMAT(record_date, '%Y-%m-%d') AS date, milking_round AS round, amount, note, DATE_FORMAT(created_at, '%H:%i:%s') AS time FROM milk_records ORDER BY record_date DESC, id DESC LIMIT 500");
  const [events] = await pool.query('SELECT id, cow_id AS cowId, category, event_type AS type, event_date AS date, note, next_date AS nextDate FROM care_events ORDER BY event_date DESC, id DESC');
  const [users] = await pool.query('SELECT id, name, email, role FROM farm_users ORDER BY id');
  const [quality] = await pool.query('SELECT id, record_date AS date, scc, fat_pct AS fat, snf_pct AS snf, mb_test AS mbTest, income, source_file AS sourceFile FROM milk_quality_records ORDER BY record_date DESC, id DESC LIMIT 100');
  const [[farm]] = await pool.query('SELECT farm_name AS name, owner_name AS owner, farm_code AS code FROM farm_settings WHERE id = 1');
  const [[notifications]] = await pool.query('SELECT dry_off AS dryOff, health_care AS healthCare, breeding, milk_quality AS milkQuality FROM notification_preferences WHERE id = 1');
  res.json({ cows, milk, events, users, quality, farm, notifications });
}));

app.post('/api/cows', asyncRoute(async (req, res) => {
  const cow = {
    id: requiredText(req.body.id, 'Cow ID', 24),
    name: requiredText(req.body.name, 'Cow name'),
    breed: requiredText(req.body.breed, 'Breed'),
    sex: requiredText(req.body.sex, 'Sex', 20),
    birth: optionalDate(req.body.birth),
    stage: requiredText(req.body.stage, 'Stage', 32)
  };
  await pool.execute('INSERT INTO cows (id, name, breed, sex, birth_date, stage) VALUES (?, ?, ?, ?, ?, ?)', [cow.id, cow.name, cow.breed, cow.sex, cow.birth, cow.stage]);
  res.status(201).json({ ...cow, yield: 0 });
}));

app.put('/api/cows/:id', asyncRoute(async (req, res) => {
  const cow = {
    id: requiredText(req.params.id, 'Cow ID', 24),
    name: requiredText(req.body.name, 'Cow name'),
    breed: requiredText(req.body.breed, 'Breed'),
    sex: requiredText(req.body.sex, 'Sex', 20),
    birth: optionalDate(req.body.birth),
    stage: requiredText(req.body.stage, 'Stage', 32)
  };
  const [result] = await pool.execute('UPDATE cows SET name = ?, breed = ?, sex = ?, birth_date = ?, stage = ? WHERE id = ?', [cow.name, cow.breed, cow.sex, cow.birth, cow.stage, cow.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Cow not found' });
  const [[row]] = await pool.execute('SELECT avg_yield AS yield FROM cows WHERE id = ?', [cow.id]);
  res.json({ ...cow, yield: row.yield });
}));

app.post('/api/milk', asyncRoute(async (req, res) => {
  const date = requiredDate(req.body.date, 'Date');
  const round = requiredText(req.body.round, 'Milking round', 16);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const cowId = req.body.cowId ? requiredText(req.body.cowId, 'Cow ID', 24) : null;
  const note = optionalText(req.body.note);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO milk_records (cow_id, record_date, milking_round, amount, note) VALUES (?, ?, ?, ?, ?)', [cowId, date, round, amount, note]);
    if (cowId) await connection.execute('UPDATE cows SET avg_yield = ? WHERE id = ?', [amount, cowId]);
    await connection.commit();
    res.status(201).json({ id: result.insertId, cowId, date, round, amount, note, time: new Date().toTimeString().slice(0, 8) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/events', asyncRoute(async (req, res) => {
  const event = {
    cowId: requiredText(req.body.cowId, 'Cow ID', 24),
    category: requiredText(req.body.category, 'Category', 32),
    type: requiredText(req.body.type, 'Event type', 64),
    date: requiredDate(req.body.date, 'Date'),
    note: optionalText(req.body.note),
    nextDate: optionalDate(req.body.nextDate)
  };
  const [result] = await pool.execute('INSERT INTO care_events (cow_id, category, event_type, event_date, note, next_date) VALUES (?, ?, ?, ?, ?, ?)', [event.cowId, event.category, event.type, event.date, event.note, event.nextDate]);
  res.status(201).json({ id: result.insertId, ...event });
}));

app.post('/api/users', asyncRoute(async (req, res) => {
  const user = {
    name: requiredText(req.body.name, 'Name'),
    email: requiredText(req.body.email, 'Email', 190),
    role: requiredText(req.body.role, 'Role', 32)
  };
  const [result] = await pool.execute('INSERT INTO farm_users (name, email, role) VALUES (?, ?, ?)', [user.name, user.email, user.role]);
  res.status(201).json({ id: result.insertId, ...user });
}));

app.patch('/api/users/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const role = requiredText(req.body.role, 'Role', 32);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid user ID' });
  const [result] = await pool.execute('UPDATE farm_users SET role = ? WHERE id = ?', [role, id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
  res.json({ id, role });
}));

app.put('/api/farm', asyncRoute(async (req, res) => {
  const farm = {
    name: optionalText(req.body.name, 100),
    owner: requiredText(req.body.owner, 'Owner name'),
    code: requiredText(req.body.code, 'Farm code', 32)
  };
  await pool.execute(
    'INSERT INTO farm_settings (id, farm_name, owner_name, farm_code) VALUES (1, ?, ?, ?) ON DUPLICATE KEY UPDATE farm_name = VALUES(farm_name), owner_name = VALUES(owner_name), farm_code = VALUES(farm_code)',
    [farm.name, farm.owner, farm.code]
  );
  res.json(farm);
}));

app.put('/api/notifications', asyncRoute(async (req, res) => {
  const settings = {
    dryOff: Boolean(req.body.dryOff),
    healthCare: Boolean(req.body.healthCare),
    breeding: Boolean(req.body.breeding),
    milkQuality: Boolean(req.body.milkQuality)
  };
  await pool.execute(
    'INSERT INTO notification_preferences (id, dry_off, health_care, breeding, milk_quality) VALUES (1, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE dry_off = VALUES(dry_off), health_care = VALUES(health_care), breeding = VALUES(breeding), milk_quality = VALUES(milk_quality)',
    [settings.dryOff, settings.healthCare, settings.breeding, settings.milkQuality]
  );
  res.json(settings);
}));

app.post('/api/quality', asyncRoute(async (req, res) => {
  const date = requiredDate(req.body.date, 'Date');
  const scc = req.body.scc === '' || req.body.scc == null ? null : Number(req.body.scc);
  const fat = req.body.fat === '' || req.body.fat == null ? null : Number(req.body.fat);
  const snf = req.body.snf === '' || req.body.snf == null ? null : Number(req.body.snf);
  const income = req.body.income === '' || req.body.income == null ? null : Number(req.body.income);
  if ([scc, fat, snf, income].some(value => value !== null && (!Number.isFinite(value) || value < 0))) return res.status(400).json({ error: 'Quality and income values must be non-negative numbers' });
  const mbTest = optionalText(req.body.mbTest, 32);
  const sourceFile = optionalText(req.body.sourceFile, 255);
  const [result] = await pool.execute('INSERT INTO milk_quality_records (record_date, scc, fat_pct, snf_pct, mb_test, income, source_file) VALUES (?, ?, ?, ?, ?, ?, ?)', [date, scc, fat, snf, mbTest, income, sourceFile]);
  res.status(201).json({ id: result.insertId, date, scc, fat, snf, mbTest, income, sourceFile });
}));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : error.code === 'ER_NO_REFERENCED_ROW_2' ? 400 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status === 500 ? 'Database operation failed' : error.message });
});

async function start() {
  await waitForMySql();
  await initializeDatabase();
  app.listen(port, () => console.log(`Dairy farm app is running at http://localhost:${port}`));
}

start().catch(error => {
  console.error('Could not connect to MySQL. Check that MySQL is running and .env credentials are correct.');
  console.error(error.message);
  process.exitCode = 1;
});