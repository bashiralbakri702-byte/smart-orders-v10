import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

const categories = ['أغذية','مشروبات','منظفات','معلبات','عناية شخصية','مستلزمات منزلية','قرطاسية','إلكترونيات'];

const prefixes = [
  'أرز','سكر','زيت','ماء','عصير','منظف','صابون','شاي',
  'قهوة','حليب','معجون','مناديل','مكرونة','دقيق','تونة','بسكويت'
];

try {
  await client.connect();

  for (const name of categories) {
    const slug = `cat-${name}`;
    await client.query(
      `INSERT INTO categories(name, slug) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING`,
      [name, slug]
    );
  }

  const categoryRows = (await client.query('SELECT id FROM categories ORDER BY id')).rows;

  for (let i = 1; i <= 200; i++) {
    const prefix = prefixes[(i - 1) % prefixes.length];
    const name = `${prefix} ${Math.ceil(i / prefixes.length)} كرتون`;
    const sku = `DEMO-${String(i).padStart(5,'0')}`;
    const barcode = `628000${String(i).padStart(6,'0')}`;
    const price = ((i % 25) + 1) * 0.75;
    const stock = 10 + (i * 7) % 190;
    const categoryId = categoryRows[(i - 1) % categoryRows.length].id;

    await client.query(`
      INSERT INTO products
      (sku, barcode, name, description, category_id, price, stock_quantity, image_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(sku) DO NOTHING
    `, [sku, barcode, name, `منتج تجريبي رقم ${i}`, categoryId, price, stock,
        `https://picsum.photos/seed/smart-${i}/600/600`]);
  }

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const adminRole = (await client.query(`SELECT id FROM roles WHERE name='admin'`)).rows[0].id;
  await client.query(`
    INSERT INTO users(role_id, full_name, email, password_hash)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(email) DO NOTHING
  `, [adminRole, 'مدير النظام', 'admin@example.com', passwordHash]);

  console.log('Seed complete: 200 demo products + admin user.');
} finally {
  await client.end();
}
