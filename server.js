import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'جلسة غير صالحة' });
  }
}

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.password_hash, r.name AS role
    FROM users u LEFT JOIN roles r ON r.id=u.role_id
    WHERE u.email=$1 AND u.is_active=true
  `, [email]);

  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.full_name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, user: { id:user.id, name:user.full_name, email:user.email, role:user.role } });
});

app.get('/api/store/products', async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const result = await pool.query(`
    SELECT p.id,p.sku,p.barcode,p.name,p.description,p.price,p.stock_quantity,
           p.image_url,c.name AS category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.is_active=true AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR COALESCE(p.barcode,'') ILIKE $1)
    ORDER BY p.id DESC LIMIT 100
  `, [q]);
  res.json(result.rows);
});

app.get('/api/products', auth, async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const result = await pool.query(`
    SELECT p.id,p.sku,p.barcode,p.name,p.description,p.price,p.stock_quantity,
           p.image_url,c.name AS category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.is_active=true AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR COALESCE(p.barcode,'') ILIKE $1)
    ORDER BY p.id DESC LIMIT 100
  `, [q]);
  res.json(result.rows);
});

app.get('/api/orders', auth, async (req, res) => {
  const result = await pool.query(`
    SELECT o.*, c.full_name AS customer_name, c.phone
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    ORDER BY o.created_at DESC LIMIT 100
  `);
  res.json(result.rows);
});

app.get('/api/orders/:id', auth, async (req, res) => {
  const order = await pool.query(`
    SELECT o.*, c.full_name AS customer_name, c.phone, c.whatsapp_phone, c.address AS customer_address, c.city
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    WHERE o.id=$1
  `, [req.params.id]);
  if (!order.rows[0]) return res.status(404).json({ error: 'الطلب غير موجود' });
  const items = await pool.query(`
    SELECT id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price, line_total
    FROM order_items WHERE order_id=$1 ORDER BY id
  `, [req.params.id]);
  const history = await pool.query(`
    SELECT h.id,h.status,h.changed_at,u.full_name AS changed_by
    FROM order_status_history h LEFT JOIN users u ON u.id=h.changed_by
    WHERE h.order_id=$1 ORDER BY h.changed_at DESC
  `, [req.params.id]);
  res.json({ ...order.rows[0], items: items.rows, history: history.rows });
});

app.patch('/api/orders/:id/status', auth, async (req, res) => {
  const allowed = new Set(['new','confirmed','preparing','shipped','completed','cancelled']);
  const { status } = req.body;
  if (!allowed.has(status)) return res.status(400).json({ error: 'حالة الطلب غير صالحة' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT id,status FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }
    if (current.rows[0].status === status) {
      await client.query('COMMIT');
      return res.json({ ok: true, status });
    }
    await client.query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);
    await client.query(`INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,$2,$3)`, [req.params.id, status, req.user.id]);
    await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)`, [req.user.id, 'order_status_changed', 'order', req.params.id, JSON.stringify({from: current.rows[0].status, to: status})]);
    await client.query('COMMIT');
    res.json({ ok: true, status });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'تعذر تحديث حالة الطلب' });
  } finally {
    client.release();
  }
});

app.get('/api/dashboard', auth, async (_, res) => {
  const [orders, products, customers, sales] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM orders WHERE status='new'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM products WHERE is_active=true`),
    pool.query(`SELECT COUNT(*)::int AS count FROM customers`),
    pool.query(`SELECT COALESCE(SUM(total),0)::numeric AS total FROM orders WHERE status <> 'cancelled'`)
  ]);
  res.json({
    newOrders: orders.rows[0].count,
    products: products.rows[0].count,
    customers: customers.rows[0].count,
    sales: sales.rows[0].total
  });
});

app.post('/api/orders', async (req, res) => {
  const { customer, items = [], source = 'website', payment_method = 'cash', notes = '' } = req.body;
  if (!customer?.full_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الطلب ناقصة' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const c = await client.query(`
      INSERT INTO customers(full_name,phone,whatsapp_phone,address,city)
      VALUES($1,$2,$3,$4,$5) RETURNING id
    `, [customer.full_name, customer.phone || null, customer.whatsapp_phone || null,
        customer.address || null, customer.city || null]);

    const customerId = c.rows[0].id;
    const orderNumber = `SO-${Date.now()}`;

    let subtotal = 0;
    const prepared = [];
    for (const item of items) {
      const p = await client.query(`SELECT id,name,sku,price,stock_quantity FROM products WHERE id=$1 AND is_active=true`, [item.product_id]);
      const product = p.rows[0];
      const qty = Number(item.quantity);
      if (!product || !Number.isInteger(qty) || qty <= 0) throw new Error('منتج أو كمية غير صالحة');
      if (product.stock_quantity < qty) throw new Error(`المخزون غير كافٍ: ${product.name}`);
      subtotal += Number(product.price) * qty;
      prepared.push({ product, qty });
    }

    const o = await client.query(`
      INSERT INTO orders(order_number,customer_id,source,payment_method,shipping_address,notes,subtotal,total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *
    `, [orderNumber, customerId, source, payment_method, customer.address || null, notes, subtotal]);

    await client.query(`INSERT INTO order_status_history(order_id,status) VALUES($1,'new')`, [o.rows[0].id]);

    for (const { product, qty } of prepared) {
      await client.query(`
        INSERT INTO order_items(order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price)
        VALUES($1,$2,$3,$4,$5,$6)
      `, [o.rows[0].id, product.id, product.name, product.sku, qty, product.price]);

      await client.query(`UPDATE products SET stock_quantity=stock_quantity-$1, updated_at=NOW() WHERE id=$2`,
        [qty, product.id]);
    }

    await client.query('COMMIT');
    res.status(201).json(o.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Smart Orders running on http://localhost:${port}`));
