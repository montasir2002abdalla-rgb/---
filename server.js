const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات', err);
  } else {
    console.log('✅ متصل بقاعدة البيانات PostgreSQL');
    initDatabase();
  }
});

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        quantity INTEGER DEFAULT 0,
        pieces_per_carton INTEGER DEFAULT 1,
        cost_piece DECIMAL(10,2) DEFAULT 0,
        price_piece DECIMAL(10,2) DEFAULT 0,
        cost_carton DECIMAL(10,2) DEFAULT 0,
        price_carton DECIMAL(10,2) DEFAULT 0,
        min_stock INTEGER DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total DECIMAL(10,2) DEFAULT 0,
        payment_method VARCHAR(50)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        unit VARCHAR(10),
        quantity INTEGER,
        price DECIMAL(10,2),
        total DECIMAL(10,2),
        profit DECIMAL(10,2) DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total DECIMAL(10,2) DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_items (
        id SERIAL PRIMARY KEY,
        purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        unit VARCHAR(10),
        quantity INTEGER,
        price DECIMAL(10,2),
        total DECIMAL(10,2)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        person_name VARCHAR(200),
        region VARCHAR(200),
        item_description TEXT,
        item_price DECIMAL(10,2) DEFAULT 0,
        my_fee DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) GENERATED ALWAYS AS (item_price + my_fee) STORED,
        status VARCHAR(50) DEFAULT 'pending'
      );
    `);

    const userCheck = await pool.query('SELECT * FROM users WHERE username = $1', ['عاصم عبدالله ود كمون']);
    if (userCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', ['عاصم عبدالله ود كمون', hashedPassword]);
      console.log('✅ تم إنشاء المستخدم الافتراضي');
    }
  } catch (err) {
    console.error('❌ خطأ في إنشاء الجداول', err);
  }
}

// ==================== مسارات API ====================

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'اسم المستخدم غير صحيح' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    res.json({ token: 'logged-in' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const username = 'عاصم عبدالله ود كمون';
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'كلمة المرور القديمة غير صحيحة' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [newHash, username]);
    res.json({ message: 'تم التغيير بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// الأصناف
app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', async (req, res) => {
  const { name, quantity, pieces_per_carton, cost_piece, price_piece, cost_carton, price_carton, min_stock } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO items 
       (name, quantity, pieces_per_carton, cost_piece, price_piece, cost_carton, price_carton, min_stock) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, quantity || 0, pieces_per_carton || 1, cost_piece || 0, price_piece || 0, cost_carton || 0, price_carton || 0, min_stock || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const { name, quantity, pieces_per_carton, cost_piece, price_piece, cost_carton, price_carton, min_stock } = req.body;
  try {
    await pool.query(
      `UPDATE items SET 
        name = $1, quantity = $2, pieces_per_carton = $3, 
        cost_piece = $4, price_piece = $5, 
        cost_carton = $6, price_carton = $7, min_stock = $8 
       WHERE id = $9`,
      [name, quantity, pieces_per_carton, cost_piece, price_piece, cost_carton, price_carton, min_stock, id]
    );
    res.json({ message: 'تم التحديث' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM items WHERE id = $1', [id]);
    res.json({ message: 'تم الحذف' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// المبيعات
app.get('/api/sales/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, COALESCE(SUM(si.profit), 0) as profit
      FROM sales s
      LEFT JOIN sale_items si ON s.id = si.sale_id
      GROUP BY s.id
      ORDER BY s.date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', async (req, res) => {
  const { items: saleItems, total, paymentMethod } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saleResult = await client.query(
      'INSERT INTO sales (total, payment_method) VALUES ($1, $2) RETURNING id',
      [total, paymentMethod]
    );
    const saleId = saleResult.rows[0].id;

    for (const item of saleItems) {
      await client.query(
        `INSERT INTO sale_items 
         (sale_id, item_id, unit, quantity, price, total, profit) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [saleId, item.id, item.unit, item.qty, item.price, item.total, item.profit]
      );

      const qtyToSubtract = item.unit === 'carton' ? item.qty * item.piecesPerCarton : item.qty;
      await client.query('UPDATE items SET quantity = quantity - $1 WHERE id = $2', [qtyToSubtract, item.id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'تم تسجيل البيع' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const { paymentMethod } = req.body;
  try {
    await pool.query('UPDATE sales SET payment_method = $1 WHERE id = $2', [paymentMethod, id]);
    res.json({ message: 'تم التحديث' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemsRes = await client.query(
      'SELECT item_id, unit, quantity, pieces_per_carton FROM sale_items si JOIN items i ON si.item_id = i.id WHERE si.sale_id = $1',
      [id]
    );
    for (const row of itemsRes.rows) {
      const qtyToAdd = row.unit === 'carton' ? row.quantity * row.pieces_per_carton : row.quantity;
      await client.query('UPDATE items SET quantity = quantity + $1 WHERE id = $2', [qtyToAdd, row.item_id]);
    }
    await client.query('DELETE FROM sales WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ message: 'تم الحذف' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// المشتريات
app.get('/api/purchases/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM purchases ORDER BY date DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchases', async (req, res) => {
  const { items: purchaseItems, total } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const purchaseResult = await client.query(
      'INSERT INTO purchases (total) VALUES ($1) RETURNING id',
      [total]
    );
    const purchaseId = purchaseResult.rows[0].id;

    for (const item of purchaseItems) {
      await client.query(
        `INSERT INTO purchase_items 
         (purchase_id, item_id, unit, quantity, price, total) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [purchaseId, item.id, item.unit, item.qty, item.price, item.total]
      );

      const qtyToAdd = item.unit === 'carton' ? item.qty * item.piecesPerCarton : item.qty;
      await client.query('UPDATE items SET quantity = quantity + $1 WHERE id = $2', [qtyToAdd, item.id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'تم تسجيل الشراء' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/purchases/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemsRes = await client.query(
      'SELECT item_id, unit, quantity, pieces_per_carton FROM purchase_items pi JOIN items i ON pi.item_id = i.id WHERE pi.purchase_id = $1',
      [id]
    );
    for (const row of itemsRes.rows) {
      const qtyToSubtract = row.unit === 'carton' ? row.quantity * row.pieces_per_carton : row.quantity;
      await client.query('UPDATE items SET quantity = quantity - $1 WHERE id = $2', [qtyToSubtract, row.item_id]);
    }
    await client.query('DELETE FROM purchases WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ message: 'تم الحذف' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// الإرساليات
app.get('/api/shipments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM shipments ORDER BY date DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shipments', async (req, res) => {
  const { personName, region, itemDescription, itemPrice, myFee, status } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO shipments (person_name, region, item_description, item_price, my_fee, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [personName, region, itemDescription, itemPrice, myFee, status || 'pending']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/shipments/:id', async (req, res) => {
  const { id } = req.params;
  const { personName, region, itemDescription, itemPrice, myFee, status } = req.body;
  try {
    await pool.query(
      'UPDATE shipments SET person_name = $1, region = $2, item_description = $3, item_price = $4, my_fee = $5, status = $6 WHERE id = $7',
      [personName, region, itemDescription, itemPrice, myFee, status, id]
    );
    res.json({ message: 'تم التحديث' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shipments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM shipments WHERE id = $1', [id]);
    res.json({ message: 'تم الحذف' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// التقارير المالية
app.get('/api/financial-summary', async (req, res) => {
  try {
    const salesTotal = await pool.query('SELECT COALESCE(SUM(total),0) as total FROM sales');
    const purchasesTotal = await pool.query('SELECT COALESCE(SUM(total),0) as total FROM purchases');
    const profitResult = await pool.query('SELECT COALESCE(SUM(profit),0) as profit FROM sale_items');
    const today = new Date().toISOString().split('T')[0];
    const todaySales = await pool.query('SELECT COALESCE(SUM(total),0) as total FROM sales WHERE date::date = $1', [today]);
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const monthSales = await pool.query('SELECT COALESCE(SUM(total),0) as total FROM sales WHERE date >= $1', [firstDay]);
    const todayProfit = await pool.query(`
      SELECT COALESCE(SUM(profit),0) as profit 
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.date::date = $1
    `, [today]);
    const monthProfit = await pool.query(`
      SELECT COALESCE(SUM(profit),0) as profit 
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.date >= $1
    `, [firstDay]);

    res.json({
      totalSales: salesTotal.rows[0].total,
      totalPurchases: purchasesTotal.rows[0].total,
      totalProfit: profitResult.rows[0].profit,
      todaySales: todaySales.rows[0].total,
      monthSales: monthSales.rows[0].total,
      todayProfit: todayProfit.rows[0].profit,
      monthProfit: monthProfit.rows[0].profit
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales/monthly', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(date, 'YYYY-MM') as month, SUM(total) as total
      FROM sales
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `);
    const months = result.rows.map(r => r.month).reverse();
    const data = result.rows.map(r => r.total).reverse();
    res.json({ months, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
});