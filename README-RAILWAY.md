# Smart Orders V10 – Railway Ready

This package is prepared for deployment as an Express + PostgreSQL application.

## Local database setup
1. Create PostgreSQL and set DATABASE_URL.
2. Run `npm install`.
3. Run `npm run db:setup`.
4. Optional: run `npm run seed` to add demo products and the demo admin account.
5. Set a strong JWT_SECRET before real use.
6. Run `npm start`.

## Railway
- Add a PostgreSQL service to the Railway project.
- Deploy this application service.
- Set `DATABASE_URL` to the PostgreSQL service connection string.
- Set `JWT_SECRET` to a long random secret.
- Run `npm run db:setup` once against the Railway database.
- For demo data, run `npm run seed` once.
- Start command: `npm start`.
