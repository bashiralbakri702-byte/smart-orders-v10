# Smart Orders v1.0

نظام أولي لإدارة المنتجات والطلبات والعملاء، قابل للتوسعة لاحقاً لربط WhatsApp Business API.

## التقنية
- Frontend: HTML + CSS + Vanilla JavaScript
- Backend: Node.js + Express
- Database: PostgreSQL
- API: REST

## التشغيل
1. ثبّت Node.js 20+ و PostgreSQL.
2. انسخ `.env.example` إلى `.env` وعدّل بيانات قاعدة البيانات.
3. نفّذ:
   npm install
   npm run db:init
   npm run seed
   npm run dev
4. افتح:
   http://localhost:3000

> بيانات المنتجات الحالية تجريبية. لا تستخدم كلمات مرور تجريبية في الإنتاج.
